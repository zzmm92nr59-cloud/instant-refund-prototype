// Flight bookings (Connor, 18 Nov 2026: "surely I have BA or Skyscanner, Ryanair, easyJet emails in my inbox?"). A paid
// booking confirmation from an airline or a travel site is the receipt of a purchase, so the receipt reader reads it within
// the shopper's existing consent; nothing else an airline sends is a receipt. This reads, from the email's own words:
// each flight (from and to airports, by their codes or names in airports.js; its day; its flight number), whether it is on
// the way out or back, the booking reference and the amount paid. Never guessed: an airport that isn't in the table, or a
// flight with no airports, isn't a flight.
//   booking: a paid booking (an amount paid, or a confirmed booking with its reference)
//   notice:  an email about a booking that isn't the purchase (check-in, boarding pass, a delay, a reminder): not a receipt
//   null:    not a flight email at all (marketing included: "Flights to Spain from £19.99" names no booking)
import { airportByCode, airportByName } from "./airports.js";

const TRAVEL_DOMAIN = /(^|\.)(ba\.com|britishairways\.com|ryanair\.com|ryanairmail\.com|easyjet\.com|jet2\.com|jet2holidays\.com|wizzair\.com|tui\.co\.uk|tui\.com|loganair\.co\.uk|aerlingus\.com|virginatlantic\.com|fly\.virgin\.com|klm\.com|klm\.co\.uk|emirates\.com|skyscanner\.net|skyscanner\.com|expedia\.co\.uk|expedia\.com|expediamail\.com|booking\.com|lastminute\.com|trip\.com|kiwi\.com|airfrance\.com|airfrance\.co\.uk|lufthansa\.com|vueling\.com|iberia\.com|norwegian\.com|qatarairways\.com|turkishairlines\.com|etihad\.com|opodo\.co\.uk|edreams\.co\.uk)$/i;
const TRAVEL_NAME = /\b(british airways|ryanair|easyjet|jet2(?:\.com|holidays)?|wizz ?air|tui|loganair|aer lingus|virgin atlantic|klm|emirates|skyscanner|expedia|booking\.com|lastminute(?:\.com)?|trip\.com|kiwi\.com|air france|lufthansa|vueling|iberia|norwegian|qatar airways|turkish airlines|etihad|opodo|edreams)\b/i;
// Rail and coach companies print station codes in brackets too ("Bristol Temple Meads (BRI)"): never read as flights.
const RAIL_DOMAIN = /(^|\.)(thetrainline\.com|trainline\.com|lner\.co\.uk|avantiwestcoast\.co\.uk|gwr\.com|southeasternrailway\.co\.uk|southernrailway\.com|thameslinkrailway\.com|northernrailway\.co\.uk|tpexpress\.co\.uk|crosscountrytrains\.co\.uk|scotrail\.co\.uk|c2c-online\.co\.uk|greateranglia\.co\.uk|chilternrailways\.co\.uk|lumo\.co\.uk|grandcentralrail\.com|hulltrains\.co\.uk|eurostar\.com|nationalrail\.co\.uk|megabus\.com|nationalexpress\.com|flixbus\.co\.uk|splitmyfare\.co\.uk|raileasy\.co\.uk)$/i;
// Flight numbers of the airlines UK flights are usually with ("BA2490", "FR 8352", "U2 8031", "EZY8031", "LS123"). Not a
// postcode: "LS1 4AB", "W6 9HR" and "BA1 1AA" have a number and two letters after them.
const FLIGHT_NO = /\b(BA|FR|EW|4Y|RK|U2|EZY|EJU|EC|DS|LS|EXS|W6|W9|W4|BY|TOM|LM|EI|VS|KL|EK|AF|LH|IB|VY|DY|D8|TK|QR|EY|AA|UA|DL|SK|TP|AZ|LX|OS|SN|BE|T3)\s?(\d{1,4})\b(?!\s?\d[A-Z]{2}\b)/;
const FLIGHT_NO_G = new RegExp(FLIGHT_NO.source, "g");
export const hasFlightNumber = (s) => FLIGHT_NO.test(String(s || "").slice(0, 200000));
// Two airport codes in a row with a way between them: "London Gatwick (LGW) to Malaga (AGP)", "LGW → AGP", "LHR 07:10 - BCN".
const BETWEEN = /\bto\b|→|->|–|—|✈|›|⇒|>|-|\barriv/i;
function codePair(win, firstLen) {
  const toks = [], re = /\(([A-Z]{3})\)|\b([A-Z]{3})\b/g;
  let m;
  while ((m = re.exec(win))) { const c = m[1] || m[2]; if (airportByCode(c)) toks.push({ c, s: m.index, e: m.index + m[0].length }); }
  for (let k = 0; k + 1 < toks.length; k++) {
    const a = toks[k], b = toks[k + 1];
    if (a.s >= firstLen) break;
    const between = win.slice(a.e, b.s);
    if (a.c !== b.c && between.length <= 60 && BETWEEN.test(between)) return { from: a.c, to: b.c, end: b.e };
    // (Or the two codes alone in a row of their own, one cell each, under the two airports' names: "| LGW | BCN |". Round 15.)
    if (a.c !== b.c && /^[\s|]*$/.test(between) && /^[\s|]*[A-Z]{3}[\s|]+[A-Z]{3}[\s|]*$/.test(win.slice(0, firstLen))) return { from: a.c, to: b.c, end: b.e };
  }
  return null;
}
const NAME_PAIR = /^\s*(?:[^:\n]{0,20}:\s*)?(\p{Lu}[\p{L} .'’-]{2,40}?)\s+(?:to|→|->|–|—)\s+(\p{Lu}[\p{L} .'’-]{2,40}?)\s*$/u;
const FROM_LABEL = /^\s*(?:from|depart(?:s|ing|ure)?|leaving|leaves|outbound from|flying from)\b\s*[:|]?/i;
const TO_LABEL = /^\s*(?:to|arriv(?:e|es|al|ing)|destination|flying to)\b\s*[:|]?/i;
const OUT_HEAD = /^\s*(?:your\s+)?(?:outbound|outward|going out|flight out|departing flight)\b/i;
const BACK_HEAD = /^\s*(?:your\s+)?(?:return|inbound|returning|coming back|flight back)(?:\s+(?:flights?|journey))?\b/i;
// What a booking email says about the money: "Total paid £245.98", "Total price: GBP 312.40", "Amount paid 189,00 EUR".
const PAID = /\b(?:total(?:\s+(?:price|paid|cost|amount|fare|charged|to pay|booking cost))?|amount\s+(?:paid|charged)|grand\s+total|price\s+paid|you\s+paid|total\s+for\s+(?:all|your)\s+[\w ]{0,20})\b[^\n0-9£€$]{0,24}?(£|€|\$|GBP|EUR|USD)?\s?(\d{1,3}(?:,\d{3})+(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\s?(GBP|EUR|USD)?/i;
const REF = /\b(?:booking\s+(?:reference|ref\.?|number|code|id)|reservation\s+(?:code|number|reference)|confirmation\s+(?:code|number)|airline\s+(?:booking\s+)?reference|pnr|itinerary\s+(?:number|no\.?|#)|trip\s+(?:id|number))(?![a-z])\s*(?:is\s*)?[:#-]?[\s|]*([A-Z0-9]{5,14})\b/i;
// (A bare "Reservation:" over its code on the next line, Ryanair's "Reservation:" "K7QXPD": a six-character code only. Round 18.)
const BARE_REF = /^[ \t|]*reservation[ \t]*:[ \t|]*(?:\n[ \t|]*){0,3}([A-Z0-9]{6})[ \t|]*$/im;
const NOTICE = /\b(check[- ]?in|boarding pass(?:es)?|flight (?:status|update|delay|delayed|cancell?ation|cancell?ed)|gate (?:change|update)|(?:is|has been|have been) (?:delayed|cancell?ed)|schedule change|time change|your (?:trip|holiday|flight) is (?:coming|almost)|get ready for|days to go|countdown|reminder|don'?t forget|manage your booking|add (?:bags|luggage|extras)|upgrade your|choose your seat|seat selection|how was your (?:flight|trip)|rate your)\b/i;
const CONFIRMED = /\b(booking (?:confirmation|confirmed|is confirmed)|(?:is|are|now) confirmed|confirmation|e-?ticket|itinerary|travel (?:confirmation|documents?)|receipt|invoice|thank(?:s| you) for (?:booking|your booking|choosing|flying)|you(?:'|’)re (?:booked|going)|your (?:[\w.&'’-]+\s+){0,2}(?:booking|flights?|trip|reservation)\b)/i;
const PROMO = /\b(sale|deals?|offers?|% off|from £|from €|cheap|lowest fares?|save (?:up to )?£|win\b|competition|newsletter|inspiration|destinations? (?:for|to)|where to next)\b/i;

const MON = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function ymd(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null; }
// The day a flight goes, from the words near it: "Sat 14 Mar 2026", "14 March", "2026-03-14", "14/03/2026". With no year,
// the first such day on or after the day the email was sent (a booking is for a flight still to come).
export function legDay(line, refDate) {
  let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}|\d{2})\b)?/i)
    || ((x) => x && [x[0], x[2], x[1], x[3]])(line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4})\b)?/i));
  if (!m) return null;
  const d = +m[1], mo = MON.indexOf(String(m[2]).slice(0, 3).toLowerCase()) + 1;
  if (!mo) return null;
  if (m[3]) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d);
  const ref = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate : null;
  if (!ref) return null;
  let y = ref.getUTCFullYear();
  if (Date.UTC(y, mo - 1, d) < ref.getTime() - 2 * 864e5) y += 1;
  return ymd(y, mo, d);
}
const NOT_FLIGHT_DAY = /\b(book(?:ed|ing)\s+(?:on|date|made)|date\s+of\s+booking|issued|payment|paid\s+on|order\s+date|purchased)\b/i;
// The lines that belong to the flight named on line i: its own, the few after it up to the next flight or heading, then the
// two before it (a heading just above it counts, the flight before it doesn't).
const isHead = (l) => OUT_HEAD.test(l) || (BACK_HEAD.test(l) && !/polic|refund|returns\b/i.test(l));
const isLeg = (l) => Boolean(codePair(l, l.length) || NAME_PAIR.exec(l));
function nearby(lines, i, fn) {
  const order = [i];
  for (let k = i + 1; k <= i + 4 && k < lines.length && !isHead(lines[k]) && !isLeg(lines[k]); k++) order.push(k);
  for (let k = i - 1; k >= i - 2 && k >= 0 && !isLeg(lines[k]); k--) { order.push(k); if (isHead(lines[k])) break; }
  for (const k of order) {
    if (NOT_FLIGHT_DAY.test(lines[k])) continue;
    const v = fn(lines[k]); if (v) return v;
  }
  return null;
}
const flightNo = (s) => { const m = FLIGHT_NO.exec(s); return m ? m[1] + m[2] : null; };
const codeIn = (s) => { const m = s.match(/\(([A-Z]{3})\)/) || s.match(/\b([A-Z]{3})\b/); return m && airportByCode(m[1]) ? m[1] : null; };
// An airport on a "Depart:" or "Arrive:" line by its code or, failing that, by its name: BA's plain-text e-ticket writes
// "Depart: 14 Mar 2026 08:10 - Charles de Gaulle (Paris) - Terminal 2C" (coverage round). Each part between dashes is tried,
// as written, without its bracket and as "city name" ("Heathrow (London)" is London Heathrow). Never guessed: a name that
// isn't in the table is no airport.
const placeIn = (s) => {
  const code = codeIn(s);
  if (code) return code;
  for (const part of s.split(/\s[-–|]\s|,\s/)) {
    // (A state's letters in brackets before the city's, "Newark Liberty (NJ) (Newark)": read without them. Round 22.)
    const p = part.trim().replace(/^([^()]{3,40}?)\s\([A-Z]{2,3}\)(?=\s\([^()]{2,30}\)$)/, "$1"), m = /^(.+?)\s*\(([^)]{2,30})\)$/.exec(p);
    for (const name of m ? [m[1], m[2] + " " + m[1]] : [p]) {
      if (!/^\p{L}[\p{L} .'’-]{2,40}$/u.test(name) || /^terminal\b/i.test(name)) continue;
      const a = airportByName(name);
      if (a) return a.code;
    }
  }
  return null;
};

// The flight number nearest a leg: the one above it ("BA2203" over the day, times and airports) or the one just after,
// whichever is closer, never one above the leg before. Round 15.
function nearestFlight(lines, i, prevAt) {
  let best = null, dist = Infinity;
  for (let k = Math.max(prevAt + 1, i - 12); k <= Math.min(lines.length - 1, i + 4); k++) {
    if (NOT_FLIGHT_DAY.test(lines[k])) continue;
    const v = flightNo(lines[k]);
    if (v && Math.abs(k - i) < dist) { best = v; dist = Math.abs(k - i); }
  }
  return best || nearby(lines, i, flightNo);
}
// An airport alone on its line, by its code, maybe after its time: "London London Heathrow (LHR)", "15:30 h London London
// Heathrow (LHR)".
const OWN_AIRPORT = /^(?:(\d{1,2}[:.]\d{2})(?:\s?h)?(?:\s?\+\d)?\s+)?(?:\p{L}[\p{L} .'’-]{1,60}\s)?\(([A-Z]{3})\)[\s|]*$/u;
// The day of a flight from the heading above it, "Sat. 6 March 2027: London – Frankfurt", never above the flight before.
function dayAbove(lines, i, prevAt, refDate, back = 12) {
  for (let k = i; k >= Math.max(prevAt + 1, i - back); k--) { if (NOT_FLIGHT_DAY.test(lines[k])) continue; const d = legDay(lines[k], refDate); if (d) return d; }
  return null;
}
// The flights an email names, in the order it names them (each once).
export function flightLegs(text, refDate) {
  const lines = String(text || "").split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const legs = [];
  let dir = null;
  const add = (from, to, i) => {
    if (!from || !to || from === to) return;
    legs.push({ from, to, date: nearby(lines, i, (l) => legDay(l, refDate)) || dayAbove(lines, i, legs.length ? legs[legs.length - 1].at : -1, refDate, 6), flight: nearestFlight(lines, i, legs.length ? legs[legs.length - 1].at : -1), dir, at: i });
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (OUT_HEAD.test(l)) dir = "out";
    else if (BACK_HEAD.test(l) && !/polic|refund|returns\b/i.test(l)) dir = "back";
    // "London Gatwick (LGW) to Malaga (AGP)", "LGW → AGP", over up to three short lines.
    const win = [l, lines[i + 1] || "", lines[i + 2] || ""].join(" ");
    const pair = codePair(win, l.length);
    if (pair) {
      add(pair.from, pair.to, i);
      if (pair.end > l.length) i += pair.end > l.length + 1 + (lines[i + 1] || "").length ? 2 : 1;
      continue;
    }
    // (Each airport on a line of its own with its time and terminal between, Lufthansa's "London London Heathrow (LHR)",
    // "Terminal 2", "18:05 h", "Frankfurt Frankfurt (FRA)": a flight when a time is among them and a flight number is near.
    // Round 18.)
    const own = OWN_AIRPORT.exec(l);
    if (own && airportByCode(own[2])) {
      let to = null, timed = Boolean(own[1]);
      for (let k = i + 1; k <= i + 6 && k < lines.length; k++) {
        const o2 = OWN_AIRPORT.exec(lines[k]);
        if (o2) { if (airportByCode(o2[2]) && o2[2] !== own[2]) { to = { c: o2[2], k }; timed = timed || Boolean(o2[1]); } break; }
        if (/^[\s|]*\d{1,2}[:.]\d{2}(?:\s?h)?(?:\s?\+\d)?[\s|]*$/i.test(lines[k])) { timed = true; continue; }
        if (/^[\s|]*(?:terminal\s+\w{1,3})?[\s|]*$/i.test(lines[k])) continue;
        break;
      }
      const prevAt = legs.length ? legs[legs.length - 1].at : -1;
      let fno = null;
      if (to && timed) for (let k = to.k + 1; k <= to.k + 8 && k < lines.length && !fno; k++) { if (/\([A-Z]{3}\)[\s|]*$/.test(lines[k])) break; fno = flightNo(lines[k]); }
      if (to && timed && !fno) for (let k = i - 1; k > prevAt && k >= i - 12 && !fno; k--) fno = flightNo(lines[k]);
      if (to && timed && fno) {
        legs.push({ from: own[2], to: to.c, date: dayAbove(lines, i, prevAt, refDate), flight: fno, dir, at: i });
        i = to.k;
        continue;
      }
    }
    // (A flight number alone on its line, then each end's day, time and airport by name on lines of their own, BA's e-ticket
    // receipt: "XY0123", "Economy", "12 Jun 2025", "09:40", "Gatwick (London)", "North Terminal", "12 Jun 2025", "12:55",
    // "Newark Liberty (NJ) (Newark)". Round 22.)
    const alone = /^[\s|]*[A-Z0-9]{2}\s?\d{1,4}[\s|]*$/.test(l) ? flightNo(l) : null;
    if (alone) {
      const ends = [];
      for (let k = i + 1; k <= i + 14 && k + 1 < lines.length && ends.length < 2; k++) {
        if (/^[\s|]*[A-Z0-9]{2}\s?\d{1,4}[\s|]*$/.test(lines[k]) && flightNo(lines[k])) break;
        if (!/^[\s|]*\d{1,2}[:.]\d{2}[\s|]*$/.test(lines[k])) continue;
        const raw = lines[k + 1].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "");
        const p = /\d/.test(raw) ? null : placeIn(raw);
        if (p) ends.push({ c: p, k: k + 1, day: legDay(lines[k - 1] || "", refDate) });
      }
      if (ends.length === 2 && ends[0].c !== ends[1].c) {
        legs.push({ from: ends[0].c, to: ends[1].c, date: ends[0].day || null, flight: alone, dir, at: i });
        i = ends[1].k;
        continue;
      }
    }
    // "From: London Gatwick (LGW)" … "To: Malaga (AGP)"; "Depart: … - Charles de Gaulle (Paris)" … "Arrive: … - Heathrow (London)".
    if (FROM_LABEL.test(l) && placeIn(l.replace(FROM_LABEL, ""))) {
      for (let k = i + 1; k <= i + 4 && k < lines.length; k++) {
        if (TO_LABEL.test(lines[k]) && placeIn(lines[k].replace(TO_LABEL, ""))) { add(placeIn(l.replace(FROM_LABEL, "")), placeIn(lines[k].replace(TO_LABEL, "")), i); i = k; break; }
      }
      continue;
    }
    // "Manchester to Alicante" with a flight number right by it.
    // (Or a travel site's "London Luton Apt → Lisbon Apt" over its day and times, "12 Jun · 06:40 - 12 Jun · 09:25",
    // with no flight number at all: Booking.com's flight confirmation. Round 24.)
    let cut = l.length; while (cut > 0 && (l[cut - 1] === "|" || l[cut - 1] === " ")) cut--;
    const named = NAME_PAIR.exec(l.slice(0, cut));
    const timed = (k) => { while (k < lines.length && k <= i + 3 && /^[\s|]*$/.test(lines[k])) k++; return k < lines.length && /\b\d{1,2}[:.]\d{2}\b/.test(lines[k]) && Boolean(legDay(lines[k], refDate)); };
    if (named && (nearby(lines, i, flightNo) || (/→/.test(l) && timed(i + 1)))) {
      const apt = (n) => airportByName(n) || airportByName(n.replace(/\s(?:Apt|Airport)\.?$/i, ""));
      const a = apt(named[1]), b = apt(named[2]);
      if (a && b) add(a.code, b.code, i);
    }
  }
  // Each flight once: a summary and the details often name it twice.
  const out = [];
  for (const g of legs) {
    const same = out.find((o) => o.from === g.from && o.to === g.to && (o.date === g.date || !o.date || !g.date) && (!o.flight || !g.flight || o.flight === g.flight));
    if (same) { same.date = same.date || g.date; same.flight = same.flight || g.flight; same.dir = same.dir || g.dir; continue; }
    out.push({ ...g });
  }
  // (A summary of the trip, "LHR-WDH" in the subject, with no flight number of its own, when flights that have one go from
  // the one airport to the other one after another: it is not a flight. Round 18.)
  for (let k = out.length - 1; k >= 0; k--) {
    const g = out[k];
    if (g.flight) continue;
    const numbered = out.filter((o) => o.flight);
    const start = numbered.findIndex((o) => o.from === g.from);
    if (start < 0) continue;
    for (let e = start; e < numbered.length; e++) {
      if (e > start && numbered[e].from !== numbered[e - 1].to) break;
      if (numbered[e].to === g.to) { if (e > start) out.splice(k, 1); break; }
    }
  }
  // Out or back: as the email's headings say; otherwise a flight towards somewhere the trip already left from is on the
  // way back (and so is everything after a break in the chain: an open jaw, Gatwick to Barcelona, Madrid to Gatwick).
  const city = (c) => (airportByCode(c) || {}).city || c;
  const fromsSoFar = new Set();
  let back = false;
  out.forEach((g, k) => {
    if (!g.dir) {
      if (!back && k > 0 && (fromsSoFar.has(city(g.to)) || g.from !== out[k - 1].to)) back = true;
      g.dir = back ? "back" : "out";
    } else back = g.dir === "back";
    fromsSoFar.add(city(g.from));
  });
  return out.map(({ from, to, date, flight, dir }) => ({ from, to, date: date || null, flight: flight || null, leg: dir }));
}

// (The label on a line of its own and the amount a few lines below, past how it was paid: Ryanair's "Total paid via",
// "MasterCard", "ending in", "1234", "120.00 GBP"; Lufthansa's "Total Price for all Passengers" over "GBP 1450.20". Round 18.)
const PAID_LABEL = /^[\s|]*(?:total(?:\s+(?:price|paid|cost|amount|charged))?(?:\s+(?:for all passengers|via))?|amount\s+(?:paid|charged)|grand\s+total|price\s+paid|you\s+paid)[\s|:]*$/i;
const PAID_SKIP = /^[\s|]*(?:(?:visa|mastercard|master card|amex|american express|maestro|paypal|apple pay|google pay|debit card|credit card|card)(?:\s+(?:debit|credit))?|ending in|\d{4}|\*{2,}\d{4})?[\s|:]*$/i;
const AMOUNT_ONLY = /^[\s|]*(£|€|\$|GBP|EUR|USD)?\s?(\d{1,3}(?:,\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s?(GBP|EUR|USD)?[\s|]*$/;
function paidBelow(lines, i) {
  for (let k = i + 1, seen = 0; k < lines.length && seen < 6; k++) {
    if (/^[\s|]*$/.test(lines[k])) continue;
    seen++;
    const m = AMOUNT_ONLY.exec(lines[k]);
    if (m && (m[1] || m[3])) return lines[k].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "");
    if (!PAID_SKIP.test(lines[k])) return null;
  }
  return null;
}
// (A travel site's price under the flights, "1 passenger · £189.40": what was paid for them all. Round 24.)
const PASSENGERS_PAID = /^[\s|]*\d{1,2} (?:passengers?|adults?|travell?ers?)[ \t]*[·•|,-][ \t]*(£|€|\$)\s?(\d{1,3}(?:,\d{3})*\.\d{2})[\s|]*$/i;
function paidOf(text) {
  const lines = String(text || "").split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const pp = PASSENGERS_PAID.exec(line);
    if (pp) line = "Total paid " + pp[1] + pp[2];
    if (PAID_LABEL.test(line) && !/\d/.test(line)) { const below = paidBelow(lines, i); if (below) line = "Total paid " + below; }
    const m = PAID.exec(line);
    if (!m || !(m[1] || m[3])) continue;
    const cur = m[1] === "£" || m[1] === "GBP" || m[3] === "GBP" ? "GBP" : m[1] === "€" || m[1] === "EUR" || m[3] === "EUR" ? "EUR" : m[1] === "USD" || m[3] === "USD" ? "USD" : null;
    if (!cur) continue;
    let n = m[2];
    // "189,00" is 189 euros; "1,234.56" is over a thousand.
    if (/^\d+,\d{2}$/.test(n)) n = n.replace(",", ".");
    const pence = Math.round(Number(n.replace(/,/g, "")) * 100);
    if (Number.isFinite(pence) && pence > 0) return { pence, currency: cur };
  }
  return null;
}
// (Booking.com's flights: "Customer reference" over "40-123456789", the reference its help centre asks for. Round 24.)
const CUSTOMER_REF = /^[ \t|]*customer reference[ \t|:]*(?:\n[ \t|]*){0,6}(\d{2}-\d{6,12})[ \t|]*$/im;
function refOf(text) {
  const m = REF.exec(String(text || "")) || BARE_REF.exec(String(text || "").slice(0, 20000)) || CUSTOMER_REF.exec(String(text || "").slice(0, 40000));
  if (!m) return null;
  const r = m[1];
  return r === r.toUpperCase() && /[A-Z]/.test(r) || /^\d{6,14}$/.test(r) || /^\d{2}-\d{6,12}$/.test(r) ? r : null;
}

// What kind of flight email this is (see the top of this file), from its subject, its text and who sent it.
export function flightBooking({ subject, text, senderDomain, fromName, refDate }) {
  const sub = String(subject || ""), body = String(text || "");
  if (RAIL_DOMAIN.test(senderDomain || "")) return null;
  const travelSender = TRAVEL_DOMAIN.test(senderDomain || "") || TRAVEL_NAME.test(fromName || "");
  const numbers = (body.match(FLIGHT_NO_G) || []).length;
  if (!travelSender && !numbers) return null;
  // (With flight numbers in the body but its airports only in the subject, "Booking details | … | LHR-WDH": the trip as the
  // subject names it, as it is read when the email is forwarded with its subject in the body. Round 18.)
  let legs = flightLegs(body, refDate);
  if (!legs.length && numbers && sub) legs = flightLegs(sub, refDate);
  if (!legs.length) return null;
  const ref = refOf(body) || refOf(sub), paid = paidOf(body);
  if (PROMO.test(sub) && !ref) return null;
  // A check-in reminder or a boarding pass isn't the purchase, even with the booking's reference on it.
  if (NOTICE.test(sub) && !/\b(booking confirm|confirmation|e-?ticket receipt|receipt|invoice)\b/i.test(sub)) return { kind: "notice", legs, ref };
  if (paid || (ref && CONFIRMED.test(sub))) return { kind: "booking", legs, ref, paid };
  return null;
}
// The one line the receipt shows for the flights: "Return flights London Gatwick to Malaga", "Flight Manchester to Alicante".
export function flightItemName(legs) {
  const out = legs.filter((g) => g.leg !== "back"), back = legs.filter((g) => g.leg === "back");
  const first = (out[0] || legs[0]), last = (out[out.length - 1] || legs[legs.length - 1]);
  const name = (c) => (airportByCode(c) || {}).name || c;
  const route = name(first.from) + " to " + name(last.to);
  return (back.length && out.length ? "Return flights " : out.length > 1 || legs.length > 1 ? "Flights " : "Flight ") + route;
}
