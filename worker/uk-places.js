// Where UK stations, towns and airports are, so Wrapped can take a shopper on each journey. The table (uk-places-data.js)
// stays on the server: the app is only sent the positions of the places its journeys name. A place a receipt names that
// isn't in the table is named in words, never guessed onto the map.
import { PLACES } from "./uk-places-data.js";

// Words written more than one way on tickets and receipts, to the way the table writes them.
const SHORT = { picc: "piccadilly", pic: "piccadilly", intl: "international", int: "international", pkwy: "parkway", pway: "parkway", pky: "parkway",
  cen: "central", cent: "central", ctrl: "central", cntrl: "central", jn: "junction", jct: "junction", jcn: "junction", junc: "junction", rd: "road",
  sq: "square", gdns: "gardens", ave: "avenue", saint: "st" };
// What tickets add round a station's name that isn't part of it: "(Return)", "Rail Station", "(any)", "Stations".
const NOISE = /\((?:open\s+)?return\)|\((?:off-?peak|anytime|advance)?\s*(?:single|day return)?\)|\((?:all stations|any|all london stations|any london terminals?)\)|\b(?:railway|rail|train)\s+station\b|\bstation\b|\bstn\b|\brail\b|\bstations\b|\bterminals?\b|\bany\b/g;
export function placeKey(s) {
  let k = String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "").replace(/&/g, " and ").replace(/~/g, " ");
  k = k.replace(NOISE, " ").replace(/[.,()\/-]/g, " ").replace(/\s+/g, " ").trim();
  return k.split(" ").map((w) => SHORT[w] || w).join(" ");
}

let INDEX = null, LIST = null, CRS = null;
// Built the first time a place is looked up, not when the Worker starts.
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map(); LIST = []; CRS = new Map();
  for (const line of PLACES.split("\n")) {
    if (!line.trim()) continue;
    const [name, lat, lon, crs, others] = line.split(";");
    const e = { name, lat: Number(lat), lon: Number(lon), crs: crs || null };
    LIST.push(e);
    for (const n of [name].concat(others ? others.split("|") : [])) { const k = placeKey(n); if (k && !INDEX.has(k)) INDEX.set(k, e); }
    if (e.crs) CRS.set(e.crs, e);
  }
  return INDEX;
}
// Street words: "London Road" is a station in Brighton (and in Guildford), not in London.
const STREET = /^(road|street|st|lane|way|avenue|park|square|fields|hill|green|cross|gate|bridge|wharf|quay|end|row|place|terrace)$/;
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.08;
// The town a place is in, when the table knows it as a place of its own: "Manchester Piccadilly" is in Manchester,
// "Leuchars" is just Leuchars.
function townOf(e) {
  const w = placeKey(e.name).split(" ");
  let self = 0;
  for (let n = w.length - 1; n >= 1; n--) {
    const t = INDEX.get(w.slice(0, n).join(" "));
    if (t === e) self = n;
    else if (t && near(t, e)) return t.name;
  }
  const nw = e.name.split(" ");
  return self && nw.length > self ? nw.slice(0, self).join(" ") : e.name.replace(/\s*\((?:[^)]*)\)$/, "");
}
const out = (e, how) => ({ name: e.name, lat: Math.round(e.lat * 1000) / 1000, lon: Math.round(e.lon * 1000) / 1000, crs: e.crs, town: townOf(e), how });

// Finds a place by the name a receipt gives it: { name, lat, lon, crs, town, how } or null. In order: its own name or another
// name for it ("London King's Cross", "Kings Cross"); its three-letter station code ("KGX"); a shortened name that fits only
// one place ("Manchester Picc"); else the town the name starts with ("Manchester Oxford Road" is in Manchester), unless the
// rest makes it a street ("London Road").
export function findPlace(name) {
  const idx = index();
  const raw = String(name || "").trim();
  if (/^[A-Z]{3}$/.test(raw) && CRS.has(raw)) return out(CRS.get(raw), "code");
  const k = placeKey(raw);
  if (!k || k.length < 2) return null;
  if (idx.has(k)) return out(idx.get(k), "name");
  if (idx.has("london " + k) && /^(kings cross|st pancras|euston|paddington|victoria|waterloo|liverpool street|marylebone|charing cross|cannon street|fenchurch street|blackfriars|bridge)$/.test(k)) return out(idx.get("london " + k), "name");
  const w = k.split(" ");
  if (w[w.length - 1] === "st" && idx.has(w.slice(0, -1).concat("street").join(" "))) return out(idx.get(w.slice(0, -1).concat("street").join(" ")), "name");
  // Shortened: every word the start of the place's word, the first word whole, the last at least three letters.
  if (w.length >= 2 && w[w.length - 1].length >= 3) {
    const hits = new Set();
    for (const [key, e] of idx) {
      const kw = key.split(" ");
      if (kw.length !== w.length || kw[0] !== w[0]) continue;
      if (w.every((x, i) => kw[i].startsWith(x))) hits.add(e);
    }
    if (hits.size === 1) return out([...hits][0], "short");
  }
  for (let n = w.length - 1; n >= 1; n--) {
    const e = idx.get(w.slice(0, n).join(" "));
    if (e && !STREET.test(w[n])) return out(e, "town");
  }
  return null;
}
// Where a place is ({ lat, lon }) or null: kept for the rest of Wrapped.
export function placeAt(name) {
  const p = findPlace(name);
  return p ? { lat: p.lat, lon: p.lon } : null;
}
// Two names for the same place, or places close enough to be the same stop on the way back ("York" and "York Station";
// "London Euston" and "London Kings Cross" are both London).
export function samePlace(a, b) {
  if (placeKey(a) === placeKey(b)) return true;
  const p = findPlace(a), q = findPlace(b);
  if (!p || !q) return false;
  return p.name === q.name || p.town === q.town || (Math.abs(p.lat - q.lat) < 0.03 && Math.abs(p.lon - q.lon) < 0.05);
}
export function placeCount() { index(); return LIST.length; }
