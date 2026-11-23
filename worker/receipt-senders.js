// What a few senders' emails say in their own way, read from their own wording (round 10, 19 Nov 2026: Connor's real
// inbox). Every rule here is a pattern the sender uses for everyone (Uber's "Here's your receipt for", "Thanks for riding",
// Just Eat's "Your East Ocean order will be with you soon", Sainsbury's "Payment received" on the delivery-day email), never
// one person's order numbers or items. Pure functions: no network, no storage.

const MONEY = /£\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})/;
const pence = (m) => (m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]) : null);
const rows = (text) => String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "").replace(/[\s|]+/g, (run) => { const k = run.split("|").length - 1; return k ? " | ".repeat(k) : run; }).trim()).filter(Boolean);
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
  // (Or, the receipt sent again after a refund, "We’ve updated your receipt for Noodle Yard.", "Your refund has been applied.",
  // "Previous total £19.40", "New Total £0.00", with the refund under the payments as "-£19.40" over "Refund"; and a ride's
  // "We adjusted the total for your recent ride.", "fare adjustment". Round 20.)
  const adj = /\bwe(?: have|(?:'|’)ve)? adjusted the total for your (?:recent )?order from ([^\n|]{2,80}?)\s*[.|\n]/i.exec(top) ||
    /\bwe(?: have|(?:'|’)ve)? updated your receipt for ([^\n|]{2,80}?)\s*[.|\n]/i.exec(top);
  if (adj || (/\bprevious total\b/i.test(t) && /\bnew total\b/i.test(t))) {
    const previousPence = labelled(list, /previous total/), newPence = labelled(list, /new total/);
    let refundPence = labelled(list, /refund/);
    if (refundPence == null) {
      // ("-£6.25" on the row over "Refund", the refund's own line under the payments.)
      const at = list.findIndex((r, i) => i > 0 && /^refund$/i.test(r) && /^[-−–]\s*£\s?[\d,]+\.\d{2}$/.test(list[i - 1]));
      if (at > 0) refundPence = pence(MONEY.exec(list[at - 1]));
      else if (previousPence != null && newPence != null && previousPence >= newPence && /\brefund\b/i.test(t)) refundPence = previousPence - newPence;
    }
    // (When the order was paid, as the payments list it, "14/05/2026 19:05", so two orders of the same total on the same day
    // from the same restaurant are told apart.)
    const pay = list.findIndex((r) => /^payments?$/i.test(r));
    const paid = pay >= 0 ? list.slice(pay + 1, pay + 6).map((r) => /^(\d{2})\/(\d{2})\/(\d{4})[ \t]+(\d{2}):(\d{2})$/.exec(r)).find(Boolean) : null;
    const ride = !adj && /\bthe total for your (?:recent )?(?:ride|trip)\b/i.test(top);
    return { kind: "adjusted", merchant: adj ? tidyName(adj[1]) : null, refundPence, previousPence, newPence,
      ...(paid ? { paidAt: `${paid[3]}-${paid[2]}-${paid[1]}T${paid[4]}:${paid[5]}` } : {}), ...(ride ? { ride: true } : {}) };
  }
  if ((/\bthanks for riding\b|\bwe hope you enjoyed your (?:ride|trip)\b|\byour [^\n]{0,30}\btrip with uber\b/i.test(top + "\n" + (subject || "")) && /\btrip fare\b|\bfare\b/i.test(t)) ||
      (/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*trip fare\b/im.test(t) && !/\bhere(?:'|’)s your receipt for\b|\buber eats\b/i.test(top))) {
    const pet = /\buber pet\b|\bpet fee\b/i.test(t);
    return { kind: "ride", item: pet ? "Uber Pet ride" : "Uber ride" };
  }
  // (A trip cancelled after the grace period: "Here's the receipt for your canceled trip", "Cancellation fee £5.00". What was
  // paid is the fee. And Uber One's own payment, "Your Uber One payment was successful", "Total charged £5.99": the
  // membership. Round 16.)
  if (/\b(?:here(?:'|’)s )?(?:the|your) receipt for your cancel+ed trip\b/i.test(top + "\n" + (subject || "")) && /^cancellation fee\b/im.test(t)) return { kind: "ride", item: "Cancellation fee", cancelled: true };
  if (/\byour uber one payment was successful\b/i.test(top + "\n" + (subject || "")) && /\btotal charged\b/i.test(t)) return { kind: "ride", item: "Uber One membership", membership: true };
  const rest = /\bhere(?:'|’)s your receipt for ([^\n|]{2,80}?)\s*\.?\s*(?:\||\n|$)/i.exec(top);
  if (rest || /\bto view your full receipt go to uber eats\b/i.test(t)) {
    // (An order the restaurant or courier couldn't complete, "Your order from Pizza Corner could not be delivered." with
    // "Total £0.00": nothing was bought. Round 20.)
    const undelivered = /\byour order from [^\n|]{2,80}? (?:could not|couldn(?:'|’)t|cannot|can(?:'|’)t) be (?:delivered|completed|fulfilled)\b/i.test(top) && labelled(list, /total/) === 0;
    return { kind: "eats", merchant: rest ? tidyName(rest[1]) : null, noItemList: /\bto view your full receipt\b/i.test(t), ...(undelivered ? { undelivered: true } : {}) };
  }
  return null;
}
// What a ride's receipt sets out between its total and its payments: the trip's fare, then each fee, tip or credit on a row
// of its own, its amount beside it or on the row under it ("Trip fare | £20.00", "Uber pet fee", "£3.00", "Wait Time", "£0.40",
// "UberX Priority £2.00", "Tip £2.00", "Uber One credits -£1.00", "Promotion -£3.00"). The ride is the fare; the rest are what
// was added or taken off, so nothing is counted twice. Only when every amount is in pounds and fare, plus fees and tips,
// less money off, comes to the total; otherwise null (and the ride stays one line for what was paid). Round 16.
const RIDE_SKIP = /^(?:subtotal|total|fare total|uber one credits earned|credits? earned|estimated fare\b.*|conversion\b.*|payments?)$/i;
export function uberRideMoney(text, totalPence) {
  if (!Number.isInteger(totalPence) || totalPence <= 0) return null;
  const list = rows(String(text || "").slice(0, 20000));
  // (A ride abroad paid in pounds: its fare lines are in euros, and under the payments "Fare total £15.00" and "Currency
  // conversion fee £0.30" make up the £15.30 paid.)
  const fareTotal = labelled(list, /fare total/), conv = labelled(list, /currency conversion fee/);
  if (fareTotal != null && conv != null && fareTotal + conv === totalPence && list.some((r) => /^trip fare\b/i.test(r)) && list.some((r) => /€|\b(?:EUR|USD|MXN|PLN)\b/.test(r)))
    return { farePence: fareTotal, fees: [{ label: "Currency conversion fee", pence: conv }], discounts: [] };
  const at = list.findIndex((r) => /^trip fare\b/i.test(r));
  if (at < 0) return fareParts(list, totalPence);
  const AMT = /^([-−–]?)\s*[£€$]\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/;
  let fare = null, sym = null; const fees = [], off = [];
  for (let i = at; i < list.length && i < at + 40; i++) {
    const r = list[i];
    if (/^(?:payments?|trip details|switch|download)\b/i.test(r) || /•{2,}|\*{4}/.test(r)) break;
    let label = null, amt = null;
    const one = /^([^|£€$\d−–-][^|£€$]{1,60}?)\s*(?:\|\s*)?([-−–]?\s*[£€$]\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/.exec(r);
    if (one) { label = one[1].trim(); amt = AMT.exec(one[2].replace(/\s+/g, "")); }
    else if (!AMT.test(r) && list[i + 1] && AMT.test(list[i + 1])) { label = r; amt = AMT.exec(list[i + 1]); i++; }
    if (!label || !amt || RIDE_SKIP.test(label)) continue;
    if (label.length > 50 || /[.!?]$/.test(label)) continue;
    const p = Number(amt[2].replace(/,/g, "")) * 100 + Number(amt[3]);
    // (Every amount in the one currency: a fare in euros with fees in pounds is not added up.)
    const cur = (/[£€$]/.exec(one ? one[2] : list[i]) || [""])[0];
    if (sym == null) sym = cur; else if (cur !== sym) return null;
    if (/^trip fare\b/i.test(label)) { if (fare == null) fare = p; continue; }
    if (fare == null) continue;
    if (amt[1] || /\b(?:credits?|promotions?|discount|savings?)\b/i.test(label)) off.push({ label, pence: p }); else fees.push({ label, pence: p });
    if (fees.length + off.length > 10) return null;
  }
  if (fare == null) return null;
  const sum = fare + fees.reduce((a, f) => a + f.pence, 0) - off.reduce((a, f) => a + f.pence, 0);
  return Math.abs(sum - totalPence) <= 1 ? { farePence: fare, fees, discounts: off } : null;
}
// (Uber's older receipt sets the fare out in parts, "Base fare €2.50", "Time €6.00", "Distance €20.10", then "Subtotal
// €28.60", and under it what was added, "Wait Time €0.40": the ride is the subtotal the parts come to, and each line under it
// a fee of its own, so the lines come to the total. Only when the parts come to the subtotal and the subtotal, plus the
// fees, less money off, to the total. Round 19.)
function fareParts(list, totalPence) {
  const b = list.findIndex((r) => /^base fare\b/i.test(r));
  if (b < 0) return null;
  const AMT = /^([-−–]?)\s*(?:[£€$]|[A-Z]{3}\s)\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/;
  let parts = 0, fare = null, sym = null; const fees = [], off = [];
  for (let i = b; i < list.length && i < b + 40; i++) {
    const r = list[i];
    if (/^(?:payments?|amount charged|trip details|switch|download)\b/i.test(r) || /•{2,}|\*{4}/.test(r)) break;
    let label = null, amt = null, raw = null;
    const one = /^([^|£€$\d−–-][^|£€$]{1,60}?)\s*(?:\|\s*)?([-−–]?\s*(?:[£€$]|[A-Z]{3}\s)\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/.exec(r);
    if (one && !/^[A-Z]{3}$/.test(one[1].trim())) { label = one[1].trim(); raw = one[2]; }
    else if (!AMT.test(r) && list[i + 1] && AMT.test(list[i + 1])) { label = r; raw = list[i + 1]; i++; }
    if (!label || !raw) continue;
    amt = AMT.exec(raw.replace(/^([-−–]?)\s+/, "$1"));
    if (!amt || label.length > 50 || /[.!?]$/.test(label)) return null;
    const cur = (/[£€$]|[A-Z]{3}/.exec(raw) || [""])[0];
    if (sym == null) sym = cur; else if (cur !== sym) return null;
    const p = Number(amt[2].replace(/,/g, "")) * 100 + Number(amt[3]);
    if (/^total$/i.test(label)) continue;
    if (/^subtotal$/i.test(label)) { if (fare != null || Math.abs(parts - p) > 1) return null; fare = p; continue; }
    if (fare == null) { if (amt[1]) return null; parts += p; continue; }
    if (amt[1] || /\b(?:credits?|promotions?|discount|savings?)\b/i.test(label)) off.push({ label, pence: p }); else fees.push({ label, pence: p });
    if (fees.length + off.length > 10) return null;
  }
  if (fare == null) return null;
  const sum = fare + fees.reduce((a, f) => a + f.pence, 0) - off.reduce((a, f) => a + f.pence, 0);
  return Math.abs(sum - totalPence) <= 1 ? { farePence: fare, fees, discounts: off } : null;
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
  // (Or "We've arranged a refund for the below amount." over the items refunded, "Qty | Product | Total", "3 | Yoghurt 150g |
  // 2.70": what they come to. Round 20.)
  let listed = null;
  if (refundPence == null && creditPence == null && /\b(?:arranged|processed|issued|approved) (?:you )?an? (?:partial |full )?refund for the (?:below|following) (?:amount|items?)\b/i.test(t)) {
    const list = rows(String(text || "").slice(0, 8000));
    const head = list.findIndex((r) => /^(?:qty|quantity) \| (?:product|item|description)s? \| (?:total|amount|price|refund)$/i.test(r));
    let sum = 0, n = 0;
    for (let i = head + 1; head >= 0 && i < list.length && i < head + 40; i++) {
      const m = /^\d{1,3} \| [^|]{2,160} \| £?\s?(\d{1,4})\.(\d{2})$/.exec(list[i]);
      if (!m) break;
      sum += Number(m[1]) * 100 + Number(m[2]); n++;
    }
    if (n) listed = sum;
  }
  if (refundPence == null && creditPence == null && listed == null) return null;
  const refs = [];
  for (const src of [t, String(subject || "")]) for (const m of src.matchAll(/\border\s*(?:number|no\.?|id)?\s*[:#]?\s*#?\s*(\d{6,14})\b/gi)) if (!refs.includes(m[1])) refs.push(m[1]);
  // ("Item refund for purchase 1234-5678-90": the purchase the subject names by its number.)
  const pm = /\b(?:refund|refunded)\b[^\n]{0,30}\bfor (?:your )?(?:purchase|order)\s+#?(\d{3,6}(?:-\d{2,6}){1,3})\s*$/i.exec(String(subject || ""));
  if (pm && !refs.includes(pm[1])) refs.unshift(pm[1]);
  return { refundPence: refundPence ?? listed, creditPence, refs };
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
    // (Or shortened, "Coins | 2.5K": 2.5K Coins. Round 22.)
    let m = /^(\p{L}[\p{L}\d '’&.-]{1,40}?) \| (x\s?)?(\d{1,3}(?:,\d{3})*|\d{1,7}|\d{1,3}(?:\.\d{1,2})?[KM])$/u.exec(r);
    const next = /^(x\s?)?(\d{1,3}(?:,\d{3})*|\d{1,7}|\d{1,3}(?:\.\d{1,2})?[KM])$/i.exec(list[k + 1] || "");
    if (!m && /^\p{L}[\p{L}\d '’&.-]{1,40}$/u.test(r) && next) { m = [null, r, next[1], next[2]]; k++; }
    // (Whatever follows the list ends it: the pack is what was read so far. A list of objects was once returned here, and
    // read as an item named "[object Object]". Round 12.)
    if (!m) break;
    parts.push({ name: m[1].trim(), amount: m[3], times: Boolean(m[2]) && Number(m[3].replace(/,/g, "")) <= 99 });
  }
  if (!parts.length) return null;
  // (Each thing in the pack is a line of its own: "Coins | 2,200" is 2,200 Coins, game money counted out; "Big SE box | x 2"
  // is two boxes; "Mixy Meow | 1" is one. The pack has one price, so no line is priced on its own. Round 15.)
  return parts.map((p) => (p.times ? { name: p.name, qty: Number(p.amount.replace(/,/g, "")) } : p.amount === "1" ? { name: p.name, qty: 1 } : { name: p.amount + " " + p.name, qty: 1 }));
}

// ---- Booking.com's booking confirmation ----------------------------------------------------------------------------------
// "Price details" sets out the stay: "2 rooms | US$1,152" (or, in its older layout, "1" over the room's name with no price of
// its own), then the taxes and charges on rows of their own ("Goods & services tax | US$215.42", "Property service charge |
// US$115.20"), then "Total price". What the email says under the price details ("This booking is non-refundable…", "City tax
// … is included") is its terms, never something bought. The room is named under "Room 1:" or in the price details; how many
// nights is "8 nights, 2 rooms". "You'll pay when you stay at …" / "You'll pay the property" means nothing was taken up front:
// the card was only a guarantee. Round 15.
const STAY_MONEY = /^(?:US\$|CA\$|A\$|€|£|\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?:\s*[A-Z]{3})?$/;
const stayPence = (s) => { const m = STAY_MONEY.exec(String(s || "").trim()); return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2] || 0) : null; };
export function bookingStay(text) {
  const list = rows(String(text || "").slice(0, 60000)).map((r) => r.replace(/[\s|]+/g, (run) => { const k = run.split("|").length - 1; return k ? " | ".repeat(k) : run; }));
  const head = list.findIndex((r) => /^price details$/i.test(r));
  if (head < 0) return null;
  const end = list.findIndex((r, i) => i > head && /^total price\b/i.test(r));
  if (end < 0 || end - head > 40) return null;
  const block = list.slice(head + 1, end);
  let rooms = null, roomPence = null, roomName = null;
  const fees = [];
  for (let i = 0; i < block.length; i++) {
    // (A label and its amount on one line, as pasted text gives them: "2 rooms US$900".)
    const one = r0 => /^(.{1,60}?)\s+((?:US\$|CA\$|A\$|€|£|\$)\s?\d[\d,]{0,9}(?:\.\d{2})?)$/.exec(r0);
    const r = block[i].includes(" | ") || !one(block[i]) ? block[i] : one(block[i]).slice(1, 3).join(" | "), [label, amount] = r.split(" | ");
    const m = /^(\d{1,2})(?: rooms?)?$/i.exec(label);
    const money = amount != null ? stayPence(amount) : stayPence(block[i + 1]);
    if (m && rooms == null) {
      rooms = Number(m[1]);
      if (money != null) { roomPence = money; if (amount == null) i++; }
      continue;
    }
    // (A name with no money of its own, in the older layout: the room.)
    if (rooms != null && !roomName && money == null && stayPence(label) == null && /^\p{Lu}[\p{L}\d &'’,-]{2,60}$/u.test(label) && !/\b(?:included|includes|per person|per night|tax)\b/i.test(label)) { roomName = label; continue; }
    if (money != null && stayPence(label) == null && /^\p{L}[\p{L}\d &'’()%.-]{2,50}$/u.test(label) && !/\bincluded\b/i.test(label)) { fees.push({ label, pence: money }); if (amount == null) i++; }
  }
  if (rooms == null) return null;
  if (!roomName) {
    // ("Room" over "1:" over "King Room with Sea View", for each room: one name when they are all the same.)
    const names = [];
    for (let k = end + 1; k < list.length - 2 && names.length < 9; k++) if (/^room$/i.test(list[k]) && /^\d{1,2}:$/.test(list[k + 1]) && /^\p{Lu}[\p{L}\d &'’,–-]{2,80}$/u.test(list[k + 2])) names.push(list[k + 2]);
    if (names.length) roomName = [...new Set(names)].join(" and ");
  }
  const n = /\b(\d{1,2}) nights?\s*,\s*\d{1,2} rooms?\b/i.exec(list.join("\n"));
  const payAtProperty = /\byou(?:'|’)ll pay (?:when you stay|the property|at the property)\b|\bpayment will be (?:made|taken) (?:at|by) the property\b|\byou(?:'|’)ll pay at the property\b/i.test(list.join(" ").slice(0, 20000));
  return { rooms, roomName, roomPence, nights: n ? Number(n[1]) : null, fees, payAtProperty };
}

// ---- Expedia's hotel booking confirmation -------------------------------------------------------------------------------
// "Itinerary # 73006597247609", "You booked 1 room." over the room's name, "Price summary" with each line's name over its
// amount ("Accommodation 1" over the rooms' price with their taxes, "Nights: 7 (avg./night)" and "Taxes" breaking it down,
// "Locally collected mandatory fees/taxes*"), then "Total", and "Collected at the property" when nothing is taken up front.
// Round 15.
export function expediaStay(text) {
  const list = rows(String(text || "").slice(0, 60000));
  const head = list.findIndex((r) => /^price summary$/i.test(r));
  if (head < 0) return null;
  const end = list.findIndex((r, i) => i > head && /^total$/i.test(r));
  if (end < 0 || end - head > 30) return null;
  const lines = [];
  for (let i = head + 1; i < end - 1; i++) { const p = stayPence(list[i + 1]); if (p != null && stayPence(list[i]) == null) { lines.push({ label: list[i], pence: p }); i++; } }
  const room = lines.find((l) => /^accommodation\b/i.test(l.label));
  if (!room) return null;
  const breakdown = (l) => /^(?:nights?\b|taxes$|taxes and fees$)/i.test(l.label);
  const fees = lines.filter((l) => l !== room && !breakdown(l));
  const booked = list.findIndex((r) => /^you booked \d{1,2} rooms?\s*\.?$/i.test(r));
  const roomName = booked >= 0 && /^\p{Lu}[\p{L}\d &'’,–-]{2,80}$/u.test(list[booked + 1] || "") ? list[booked + 1] : null;
  const rooms = booked >= 0 ? Number(/\d{1,2}/.exec(list[booked])[0]) : 1;
  const n = /^nights?:\s*(\d{1,2})\b/i.exec((lines.find((l) => /^nights?:/i.test(l.label)) || {}).label || "");
  const ref = /\bitinerary\s*#\s*(\d{8,16})\b/i.exec(list.slice(0, 40).join("\n"));
  const payAtProperty = /^collected at the property$/i.test(list[end + 2] || "") || /^collected at the property$/i.test(list[end + 1] || "");
  return { rooms, roomName, roomPence: room.pence, nights: n ? Number(n[1]) : null, fees, payAtProperty, orderRef: ref ? ref[1] : null };
}

// (Each fee is marked charge: true, so the list shown keeps it as the line the email sets out, "Service Charge Full Price
// Ticket", "Delivery/transaction costs", where a line named only by money words would be left out. Round 19.)
// ---- A ticket seller's payment summary (round 15) ------------------------------------------------------------------------
// "Payment Summary", "2 Full Price Ticket" over "£40.00 x2" and the line's "£80.00", then "Per Item Fees" with
// "£4.40 (Service Charge Full Price Ticket) x2", then "Order Processing Fees" with "Handling Fee (£2.95)", then "Total":
// the tickets (named by the event the email is for, the ticket type their detail), each fee per ticket, and the order's
// own fee. The event is the line under the order's number ("Order #15-25252/UK1" / "Comedy Night: The Tour"). Used only
// when it all adds up to the total; otherwise nothing.
// (Or, in a plain-text part, "ORDER DETAILS", the event's name, "Date:", "Venue:", then "Seats, Full Price Ticket: 2 x £ 30.00 =
// £ 60.00", "Booking fee: 2 x £ 3.75 = £ 7.50", "Processing fee: £ 1.50" down to "Total incl. VAT".)
const PER = /^(\p{L}[^:£]{2,60}?):\s*(\d{1,2})\s*[x×]\s*£\s?([\d,]+\.\d{2})\s*=\s*£\s?([\d,]+\.\d{2})$/u;
const ONCE = /^(\p{L}[^:£]{2,60}?):\s*£\s?([\d,]+\.\d{2})$/u;
function ticketDetails(list, totalPence) {
  const at = list.findIndex((l) => /^order details$/i.test(l));
  if (at < 0) return null;
  const event = list[at + 1] && !/£/.test(list[at + 1]) && !/^(?:date|time|venue|promoter|location|address|seats?|entrance)\s*:/i.test(list[at + 1]) && /\p{L}{3}/u.test(list[at + 1]) && list[at + 1].length <= 90 ? list[at + 1] : null;
  const items = [];
  for (let k = at + 1; k < list.length && k < at + 40; k++) {
    const l = list[k];
    if (/^total\b[^:]*:/i.test(l)) break;
    const per = PER.exec(l);
    if (per) {
      if (Number(per[2]) * pence(MONEY.exec("£" + per[3])) !== pence(MONEY.exec("£" + per[4]))) return null;
      const ticket = /\btickets?\b/i.test(per[1]);
      items.push({ name: ticket && event ? event : per[1].trim(), ...(ticket && event ? { variant: per[1].trim() } : { charge: true }), qty: Number(per[2]), pricePence: pence(MONEY.exec("£" + per[3])) });
      continue;
    }
    const once = ONCE.exec(l);
    if (once && !/^(?:sub-?\s?total|total|order total|vat|date|venue|promoter)\b/i.test(once[1])) items.push({ name: once[1].trim(), qty: 1, pricePence: pence(MONEY.exec("£" + once[2])), charge: true });
  }
  const sum = items.reduce((n, i) => n + i.qty * i.pricePence, 0);
  return items.some((i) => i.variant || /ticket/i.test(i.name)) && sum === totalPence ? items : null;
}
export function ticketSummary(text, totalPence) {
  const list = rows(String(text || "").slice(0, 40000));
  if (totalPence == null) return null;
  const at = list.findIndex((l) => /^payment summary$/i.test(l));
  if (at < 0) return ticketDetails(list, totalPence);
  const ord = list.findIndex((l) => /^order\s*#\s*[A-Z0-9][A-Z0-9/-]{3,30}$/i.test(l));
  const event = ord >= 0 && ord + 1 < at && /\p{L}{3}/u.test(list[ord + 1]) && !/£/.test(list[ord + 1]) && list[ord + 1].length <= 90 ? list[ord + 1] : null;
  const items = [];
  for (let k = at + 1; k < list.length && k < at + 40; k++) {
    const l = list[k];
    if (/^total\b/i.test(l)) break;
    const tix = /^(\d{1,2})\s+(\p{L}[^£|]{2,60})$/u.exec(l), each = /^£\s?([\d,]+\.\d{2})\s*x\s?(\d{1,2})$/i.exec(list[k + 1] || "");
    if (tix && each && Number(tix[1]) === Number(each[2])) {
      items.push({ name: event || tix[2].trim(), ...(event ? { variant: tix[2].trim() } : {}), qty: Number(tix[1]), pricePence: pence(MONEY.exec("£" + each[1])) });
      k++; continue;
    }
    const fee = /^£\s?([\d,]+\.\d{2})\s*\(([^()£]{3,60})\)\s*x\s?(\d{1,2})$/i.exec(l);
    if (fee) { items.push({ name: fee[2].trim(), qty: Number(fee[3]), pricePence: pence(MONEY.exec("£" + fee[1])), charge: true }); continue; }
    const once = /^(\p{L}[^()£]{2,60}?)\s*\(£\s?([\d,]+\.\d{2})\)$/u.exec(l);
    if (once) { items.push({ name: once[1].trim(), qty: 1, pricePence: pence(MONEY.exec("£" + once[2])), charge: true }); continue; }
  }
  const sum = items.reduce((n, i) => n + i.qty * i.pricePence, 0);
  return items.length && items.some((i) => i.variant || /ticket/i.test(i.name)) && sum === totalPence ? items : null;
}

// ---- Items set out as labelled fields, and "N x Name @ £P" lines (round 15) ---------------------------------------------
// "Item: Xbox One S Console, 1TB", "Category: …", "Quantity: 1", "Unit Price: £135.00" (a plain-text order email), each item
// its own block; and a booking's "4 x Make a pot like Grayson Perry @ £40.00". Only what the email says, nothing worked out.
export function labelledItems(text) {
  const list0 = rows(String(text || "").slice(0, 40000)).map((l) => l.replace(/[\s|]+/g, (run) => { const k = run.split("|").length - 1; return k ? " ".repeat(k) : run; }).trim()).filter(Boolean);
  // (Each label on its own line over its value, "Item:" over "Especially For You Letterbox", "Price:" over "£24.0": one line
  // each. Round 15e.)
  const list = [];
  for (let k = 0; k < list0.length; k++) {
    if (/^(?:item|quantity|qty|unit price|price|item price|discount)\s*:$/i.test(list0[k]) && list0[k + 1] && !/:$/.test(list0[k + 1])) { list.push(list0[k] + " " + list0[k + 1]); k++; }
    else list.push(list0[k]);
  }
  const out = [];
  for (let k = 0; k < list.length && out.length < 30; k++) {
    const at = /^(\d{1,3})\s*x\s+(\p{L}[^@£]{1,80}?)\s*@\s*£\s?([\d,]+\.\d{2})(?:\s*(?:each|per person|pp))?$/iu.exec(list[k]);
    if (at) { out.push({ name: at[2].trim(), qty: Number(at[1]), pricePence: pence(MONEY.exec("£" + at[3])), lineTotal: false }); continue; }
    const item = /^item\s*:\s*(\p{L}.{2,120})$/iu.exec(list[k]);
    if (!item) continue;
    let qty = null, unit = null;
    for (let j = k + 1; j < Math.min(list.length, k + 12) && !/^item\s*:/i.test(list[j]); j++) {
      const q = /^(?:quantity|qty)\s*:\s*(\d{1,3})$/i.exec(list[j]);
      if (q) qty = Number(q[1]);
      // ("£24.0": a price written with one figure after the point is £24.00.)
      const u = /^(?:unit price|price|item price)\s*:\s*£\s?(\d[\d,]*)(?:\.(\d{1,2}))?$/i.exec(list[j]);
      if (u && unit == null) unit = Number(u[1].replace(/,/g, "")) * 100 + Number((u[2] || "0").padEnd(2, "0"));
    }
    if (unit != null) out.push({ name: item[1].trim(), qty: qty || 1, pricePence: unit, lineTotal: false });
  }
  return out;
}

// ---- A shop's till receipt sent by email (Ecrebo and the like) ----------------------------------------------------------
// The till's own lines under "Item | Price": each thing and what it came to, in pounds with no "£" ("Steel Mop Bucket
// | 18.00"), several of one thing said under its name ("Quantity: 2 at £6.00 each"), then "TOTAL" with how many things
// and what was paid ("9 Items | £64.50"). Only when the lines come to that total and their count to that number; otherwise
// null. Round 20.
export function tillEReceipt(text) {
  // (Copied from the page, its cells come apart with tabs.)
  const list = rows(String(text || "").slice(0, 40000).replace(/[ \t]+/g, (run) => (run.includes("\t") ? " | " : run)));
  const head = list.findIndex((r) => /^(?:item|description|product)s? \| (?:price|amount|value|£)$/i.test(r));
  if (head < 0) return null;
  const items = [];
  let pendingName = null, pendingQty = null, totalPence = null, count = null;
  for (let i = head + 1; i < list.length && i < head + 400; i++) {
    const r = list[i];
    const tot = /^total$/i.test(r) ? /^(\d{1,4}) items? \| £\s?(\d{1,5})\.(\d{2})$/i.exec(list[i + 1] || "") : /^total(?: \| )?(?:(\d{1,4}) items? \| )?£\s?(\d{1,5})\.(\d{2})$/i.exec(r);
    if (tot) { count = tot[1] ? Number(tot[1]) : null; totalPence = Number(tot[2]) * 100 + Number(tot[3]); break; }
    const qty = /^quantity\s*:\s*(\d{1,3}) at £\s?(\d{1,5})\.(\d{2}) each$/i.exec(r);
    if (qty) { pendingQty = { qty: Number(qty[1]), each: Number(qty[2]) * 100 + Number(qty[3]) }; continue; }
    if (/^s\/n\s*:/i.test(r)) {
      // ("S/N: | | 12.00": the line's amount, under its name and how many.)
      const amt = /\| ([-−–]?)(\d{1,5})\.(\d{2})$/.exec(r);
      if (amt && pendingName) { items.push({ name: pendingName, qty: pendingQty ? pendingQty.qty : 1, pricePence: (Number(amt[2]) * 100 + Number(amt[3])) * (amt[1] ? -1 : 1), ...(pendingQty && pendingQty.qty > 1 ? { lineTotal: true } : {}) }); pendingName = null; pendingQty = null; }
      continue;
    }
    const line = /^(\p{L}[^|£]{1,60}?) \| ([-−–]?)(\d{1,5})\.(\d{2})$/u.exec(r);
    if (line) {
      const p = (Number(line[3]) * 100 + Number(line[4])) * (line[2] ? -1 : 1);
      const q = pendingQty && pendingName === null ? pendingQty : null;
      items.push({ name: line[1].trim(), qty: q ? q.qty : 1, pricePence: p, ...(q && q.qty > 1 ? { lineTotal: true } : {}) });
      pendingQty = null; continue;
    }
    if (/^\p{L}[^|£]{1,60}$/u.test(r)) { pendingName = r.trim(); pendingQty = null; continue; }
    return null;
  }
  if (totalPence == null || !items.length || items.some((x) => x.pricePence < 0)) return null;
  const sum = items.reduce((a, x) => a + x.pricePence, 0), n = items.reduce((a, x) => a + x.qty, 0);
  if (sum !== totalPence || (count != null && count !== n)) return null;
  // (Each line's own price: several of one thing keep the price of one.)
  return { items: items.map((x) => (x.lineTotal ? { name: x.name, qty: x.qty, pricePence: x.pricePence, lineTotal: true } : x)), totalPence };
}

// ---- Receipts sent for a shop by an e-receipt or ordering platform ---------------------------------------------------------
// A till receipt emailed by Ecrebo ("Your Digital Receipt" from a homeware shop), yReceipts ("Your receipt from Tailor
// & Co", the receipt itself a picture), me&u ("Your receipt from Wine Bar Riverside", the receipt behind "View receipt"),
// OrderYOYO ("Spice House | Your order 10203040 is accepted") and Viva Wallet's "Successful Payment" for a shop
// ("Requested by | Example Trading Ltd", "Description | Cloud Shop", "Amount | £21.40"): the shop's purchase, named by the shop, sent
// by the platform. Round 20.
const shopName = (n) => { const s = tidyName(String(n || "").replace(/["“”]/g, "")); return s.length >= 2 && s.length <= 80 ? s : null; };
export function eReceiptPlatform(domain, subject, fromName, text) {
  const t = String(text || "").slice(0, 8000);
  // (Pasted in, the email has no sender or subject of its own: the sender's address and the subject are its top lines.)
  const pastedFrom = !domain ? /^[^\n@]{0,80}<?[\w.+-]{1,64}@([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,4})>?[ \t]*$/im.exec(t.slice(0, 600)) : null;
  const d = String(domain || (pastedFrom ? pastedFrom[1] : "")).toLowerCase();
  const pastedSubject = !subject && pastedFrom ? (t.slice(0, 600).split("\n").find((l) => /\breceipt from\b|\byour order\b|\bsuccessful payment\b|\breceipt\b/i.test(l)) || "") : "";
  const s = String(subject || pastedSubject).replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "").trim().slice(0, 300);
  if (/(^|\.)ecrebo\.com$/.test(d) && (/\b(?:digital|e-?)\s?receipt\b/i.test(s) || /\be-?receipt\b/i.test(t.slice(0, 1500)))) {
    const sub = /^([a-z][a-z0-9]{1,30})(?:-[a-z]+)?\.ecrebo\.com$/.exec(d);
    return { platform: d, shop: shopName(fromName) || (sub ? sub[1][0].toUpperCase() + sub[1].slice(1) : null) };
  }
  const from = /\breceipt from (\S[^|]{1,79})$/i.exec(s);
  if (/(^|\.)yreceipts\.com$/.test(d) && from) {
    // (Its words only the shop's name, once what a forward adds at its top is left out.)
    const own = t.replace(/^[ \t>*|]*(?:-+ ?forwarded message ?-+|begin forwarded message:|_{8,}|(?:from|sent|date|to|subject|cc)\s*:[^\n]{0,300})[ \t|]*$/gim, "");
    return { platform: d, shop: shopName(from[1]), picture: own.replace(/\s+/g, " ").trim().length < 200 };
  }
  if (/(^|\.)meandu\.(?:com|app|com\.au)$/.test(d) && from) return { platform: d, shop: shopName(from[1]), atLink: /\bview (?:your )?(?:order (?:&|and) )?receipt\b/i.test(t) };
  if (/(^|\.)orderyoyo\.com$/.test(d)) {
    const m = /^(\S[^|]{1,59}?)\s*\|\s*your order\s+#?\d{3,14}\s+(?:is|has been)\s+(?:accepted|confirmed|received)\b/i.exec(s);
    if (m) return { platform: d, shop: shopName(m[1]) };
  }
  if (/(^|\.)viva(?:wallet)?\.com$/.test(d) && /\bsuccessful payment\b/i.test(s)) {
    const list = rows(t);
    const cell = (re) => { for (const r of list) { const m = new RegExp("^(?:" + re.source + ") \\| (.{1,80})$", "i").exec(r); if (m) return m[1].trim(); } return null; };
    const by = cell(/requested by/), what = cell(/description/), amt = MONEY.exec(cell(/amount/) || "");
    if (!amt || !(by || what)) return null;
    // (The description is the shop's own words: its name when it is a name, otherwise who asked for the money.)
    const name = what && /^\p{L}[\p{L}&'’ .-]{1,40}$/u.test(what) ? what : by;
    return { platform: d, shop: shopName(name), amountPence: pence(amt) };
  }
  return null;
}

// ---- A takeaway's own ordering page's email (OrderYOYO and the like) --------------------------------------------------------
// "Pcs | Name | Total", then each thing as how many, its name, what was chosen with it ("+ Paneer") and its price, the
// pound sign in a cell of its own ("£ | 8.50"); then "Subtotal", money off ("Discount 10%" "-2.10"), what was added
// ("Delivery", "Bag fee", "Service fee") and "Total (Incl. VAT)". Only when the things come to the subtotal and the subtotal,
// less money off, plus what was added, to the total; otherwise null. Round 20.
export function pcsOrder(text) {
  const list = rows(String(text || "").slice(0, 30000));
  const head = list.findIndex((r) => /^(?:pcs|qty|quantity) \| (?:name|item|product)s? \| (?:total|price|amount)$/i.test(r));
  if (head < 0) return null;
  const AMT = /^(?:£ \| |£\s?)?([-−–])?\s?(\d{1,5})\.(\d{2})$/;
  const amt = (r) => { const m = AMT.exec(r || ""); return m ? (Number(m[2]) * 100 + Number(m[3])) * (m[1] ? -1 : 1) : null; };
  const items = [], fees = [], discounts = [];
  let subtotal = null, total = null, i = head + 1;
  for (; i < list.length && i < head + 300; ) {
    const q = /^(\d{1,3})$/.exec(list[i]);
    if (!q) break;
    const name = list[i + 1];
    if (!name || !/^\p{L}/u.test(name) || name.length > 100) return null;
    const extras = [];
    let k = i + 2;
    while (k < list.length && /^\+\s?\S/.test(list[k]) && extras.length < 8) { extras.push(list[k].replace(/^\+\s?/, "").trim()); k++; }
    const p = amt(list[k]);
    if (p == null || p < 0) return null;
    const qty = Number(q[1]);
    items.push({ name: name.replace(/\s+\)$/, ")").trim(), qty, pricePence: p, ...(qty > 1 ? { lineTotal: true } : {}), ...(extras.length ? { variant: extras.join(", ") } : {}) });
    i = k + 1;
  }
  for (; i < list.length && i < head + 340; i++) {
    const label = list[i], p = amt(list[i + 1]);
    if (p == null || !/^\p{L}[^|£]{1,40}$/u.test(label)) continue;
    if (/^sub-?\s?total\b/i.test(label)) subtotal = p;
    else if (/^total\b/i.test(label)) { total = p; break; }
    else if (p < 0 || /\b(?:discount|voucher|promo(?:tion)?|offer|saving)\b/i.test(label)) discounts.push({ label, pence: Math.abs(p) });
    else if (p > 0) fees.push({ label, pence: p });
    i++;
  }
  if (!items.length || total == null || subtotal == null) return null;
  const sum = items.reduce((a, x) => a + x.pricePence, 0);
  if (sum !== subtotal || subtotal - discounts.reduce((a, x) => a + x.pence, 0) + fees.reduce((a, x) => a + x.pence, 0) !== total) return null;
  return { items, fees, discounts, totalPence: total };
}

// ---- A subscription started today ---------------------------------------------------------------------------------------
// "Thanks for subscribing to StreamBox Plus", "You'll be charged £7.49/1 month(s) starting on 02/03/2026": the first payment is
// taken the day the email says, so when that is the day it was sent (or the next), the subscription was bought that day for
// that much. A later start (a free trial) is nothing paid yet: null. Round 20.
export function subscriptionStarted(subject, text, sentOn) {
  const t = String(text || "").slice(0, 6000).replace(/[ \t]+/g, " ");
  const name = /\bthanks? (?:you )?for subscribing to ([\p{L}\d][^\n.!|]{1,50}?)\s*[.!\n|]/iu.exec(t);
  const charge = /\b(?:you(?:'|’)ll|you will) be charged £\s?(\d{1,4})\.(\d{2})\s*(?:\/|per|a|every)\s*[^\n]{0,30}?\bstarting (?:on|from) (\d{1,2})\/(\d{1,2})\/(\d{4})\b/i.exec(t);
  if (!name || !charge || !/^\d{4}-\d{2}-\d{2}$/.test(String(sentOn || ""))) return null;
  const start = Date.UTC(+charge[5], +charge[4] - 1, +charge[3]), sent = Date.parse(sentOn + "T00:00:00Z");
  if (!Number.isFinite(start) || start < sent || start - sent > 864e5) return null;
  return { name: tidyName(name[1]), pence: Number(charge[1]) * 100 + Number(charge[2]) };
}
