// Finding which receipts could fit a rule without checking each one against every other (gmail.js mergeOrderEmails,
// attachDeliveries, attachCancellations; return-tracking.js matchReturnNews).
// Which of `list` could fit a rule, found by keys worked out once (an order's number, shop, total or time) instead of by
// checking every order against every other: the rule itself is then checked on these alone, in the list's own order, so
// the answer is exactly the one checking every order gives. A shopper with thousands of receipts waited seconds for their
// list while each email was compared with all the others (20 Nov 2026). An order whose key can't be worked out is always
// checked, as before.
export function indexBy(list, keysOf) {
  const m = new Map(), wild = [];
  list.forEach((x, i) => {
    let keys; try { keys = keysOf(x); } catch { wild.push(i); return; }
    for (const k of keys) { if (k == null) continue; const a = m.get(k); if (!a) m.set(k, [i]); else if (a[a.length - 1] !== i) a.push(i); }
  });
  return { list, m, wild };
}
export function amongAt(ix, keys) {
  const at = new Set(ix.wild);
  for (const k of keys) for (const i of ix.m.get(k) || []) at.add(i);
  return [...at].sort((a, b) => a - b);
}
export function among(ix, keys) { return amongAt(ix, keys).map((i) => ix.list[i]); }
// The same by time: the orders whose `field` (a time Date.parse reads) is within `ms` of a moment.
export function byTime(list, field) {
  const t = [];
  list.forEach((x, i) => { const v = x && x[field] ? Date.parse(x[field]) : NaN; if (Number.isFinite(v)) t.push([v, i]); });
  t.sort((a, b) => a[0] - b[0]);
  return { list, t };
}
export function nearTime(ix, at, ms) { return nearTimeAt(ix, at, ms).map((i) => ix.list[i]); }
export function nearTimeAt(ix, at, ms) {
  if (!Number.isFinite(at)) return [];
  let lo = 0, hi = ix.t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.t[mid][0] < at - ms) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let k = lo; k < ix.t.length && ix.t[k][0] <= at + ms; k++) out.push(ix.t[k][1]);
  return out.sort((a, b) => a - b);
}
