// Live parcel tracking (Connor, 16 Nov 2026): a parcel whose emails stopped at "shipped" can still say where it really
// is. Relay asks Ship24, a tracking service that reads Royal Mail, Evri, DPD and the rest, using the tracking number from
// the shop's or carrier's email.
//
// Rules (do not weaken):
//  * Off for everyone until SHIP24_API_KEY is set (a Cloudflare secret, never in code).
//  * Only the tracking number goes to Ship24 (and "GB" as where it's going, and the carrier's code for Royal Mail). Never the shopper's name, email, address,
//    order number or what they bought.
//  * Only for a parcel on one of the shopper's own receipts, not yet delivered, ordered in the last 30 days, and only when
//    they open that purchase's page. Nothing runs on a timer.
//  * Ship24's free plan covers 10 new parcels a month for all of Relay, so each new tracking number counts once
//    (PARCEL_TRACKS_PER_MONTH, 10 unless set) and each shopper starts at most 3 a month. A parcel already being tracked
//    is looked up again at most every 2 hours (10 minutes while the carrier has no news yet), and never after it's delivered.
//  * Relay says only what the carrier said: the milestone and its date, or the carrier's own expected date. Nothing
//    is guessed; with no news from the carrier, the email's word stands.
//  * Kept with the shopper (parcel_tracks), shown in their export, deleted with their inbox, permission or account.
//
// GET /relay/my/receipts/<id>/parcel: { available, delivery } (delivery as on a receipt, or null when there's no news).
export const PARCEL_TRACKS_SQL = `CREATE TABLE IF NOT EXISTS parcel_tracks (shopper_id TEXT NOT NULL, tracking_number TEXT NOT NULL,
  status TEXT, at TEXT, checked_at INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, tracking_number))`;
export const PARCEL_USES_SQL = `CREATE TABLE IF NOT EXISTS parcel_track_uses (month TEXT PRIMARY KEY, n INTEGER NOT NULL)`;

export const trackingAvailable = (env) => Boolean(env && env.SHIP24_API_KEY);
const API = "https://api.ship24.com/public/v1";
const AGAIN_AFTER = 2 * 36e5, NO_NEWS_AGAIN = 10 * 60e3,   // no news yet (Ship24 still finding the carrier): sooner
  PER_SHOPPER = 3, DAY = 864e5;
const FINAL = new Set(["delivered", "problem"]);
// A tracking number as carriers print them: letters and digits, 8 to 40 of them.
export const TRACKING_NUMBER = /^[A-Z0-9]{8,40}$/;
// Ship24 can't find Royal Mail parcels on its own: it needs its code for Royal Mail, "gb-post" (help.ship24.com, "How to
// track Royal Mail packages"). Other carriers it finds from the number.
export const courierCode = (carrier) => (/royal\s*mail|parcelforce/i.test(String(carrier || "")) ? (/parcelforce/i.test(carrier) ? null : "gb-post") : null);
const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

// What Ship24 said, in Relay's words. Returns { status, at } or null when the carrier has no news yet.
//   delivered, out_for_delivery, collect (waiting at a pickup point), missed (a delivery was attempted), problem (being
//   sent back, lost or destroyed), due (on its way with the carrier's expected date), in_transit (on its way).
export function readShip24(body, today) {
  const t = body && body.data && Array.isArray(body.data.trackings) ? body.data.trackings[0] : null;
  if (!t) return null;
  const sh = t.shipment || {};
  const events = (Array.isArray(t.events) ? t.events : []).filter((e) => e && day(e.occurrenceDatetime))
    .sort((a, b) => String(b.occurrenceDatetime).localeCompare(String(a.occurrenceDatetime)));
  const milestone = sh.statusMilestone || (events[0] && events[0].statusMilestone) || "pending";
  const latest = events[0] ? day(events[0].occurrenceDatetime) : null;
  const when = (m) => { const e = events.find((x) => x.statusMilestone === m); return e ? day(e.occurrenceDatetime) : latest; };
  switch (milestone) {
    case "delivered": return { status: "delivered", at: when("delivered") };
    case "out_for_delivery": return { status: "out_for_delivery", at: when("out_for_delivery") };
    case "available_for_pickup": return { status: "collect", at: when("available_for_pickup") };
    case "failed_attempt": return { status: "missed", at: when("failed_attempt") };
    case "exception": return { status: "problem", at: when("exception") };
    case "in_transit": {
      const eta = day(sh.delivery && sh.delivery.estimatedDeliveryDate);
      return eta && eta >= today ? { status: "due", at: eta } : { status: "in_transit", at: latest };
    }
    default: return null;   // pending, info_received: nothing the email didn't already say
  }
}

// The carrier's news replaces the email's, unless the email already says delivered and the carrier doesn't.
export function applyTracked(orders, rows) {
  const byNumber = new Map((rows || []).filter((r) => r && r.status).map((r) => [String(r.tracking_number).toUpperCase(), r]));
  if (!byNumber.size) return;
  for (const o of orders) {
    const dv = o.delivery, r = dv && dv.trackingNumber && byNumber.get(String(dv.trackingNumber).toUpperCase());
    if (!r || (dv.status === "delivered" && r.status !== "delivered")) continue;
    dv.status = r.status; dv.at = r.at || dv.at || null; dv.live = true;
  }
}

export async function readTrackedRows(db, shopperId) {
  try { return (await db.prepare("SELECT tracking_number, status, at FROM parcel_tracks WHERE shopper_id = ?").bind(shopperId).all()).results || []; }
  catch { return []; }   // not made yet: nothing tracked
}

async function ask(env, fetchImpl, url, init) {
  try {
    const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000),
      headers: { Authorization: "Bearer " + env.SHIP24_API_KEY, "Content-Type": "application/json; charset=utf-8" } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, body: await r.json().catch(() => null) };
  } catch { return { ok: false, status: 0 }; }
}

// The parcel on one of the shopper's receipts. `order` comes from their own receipts list, so it is theirs.
export async function liveParcel(env, shopperId, order, o = {}) {
  const now = o.now || Date.now(), fetchImpl = o.fetchImpl || fetch, db = env.RELAY_DB;
  const today = new Date(now).toISOString().slice(0, 10);
  if (!trackingAvailable(env)) return { available: false, delivery: null };
  const dv = order && order.delivery, tn = dv && String(dv.trackingNumber || "").toUpperCase();
  const recent = order && day(order.orderDate) && now - Date.parse(day(order.orderDate)) <= 30 * DAY;
  if (!dv || !TRACKING_NUMBER.test(tn) || dv.status === "delivered" || !recent) return { available: true, delivery: null, reason: "not_tracked" };
  await db.batch([db.prepare(PARCEL_TRACKS_SQL), db.prepare(PARCEL_USES_SQL)]);
  const mine = await db.prepare("SELECT status, at, checked_at, created_at FROM parcel_tracks WHERE shopper_id = ? AND tracking_number = ?").bind(shopperId, tn).first();
  const answer = (row) => ({ available: true, delivery: row && row.status ? { ...dv, status: row.status, at: row.at || null, live: true } : null });
  if (mine && (FINAL.has(mine.status) || now - mine.checked_at < (mine.status ? AGAIN_AFTER : NO_NEWS_AGAIN))) return answer(mine);

  // Tracked before (by anyone): look up the results again, which doesn't count as a new parcel.
  const known = mine || await db.prepare("SELECT 1 AS x FROM parcel_tracks WHERE tracking_number = ? LIMIT 1").bind(tn).first();
  let res;
  if (known) res = await ask(env, fetchImpl, `${API}/trackers/search/${encodeURIComponent(tn)}/results`, { method: "GET" });
  else {
    const month = today.slice(0, 7), cap = Math.max(0, Number(env.PARCEL_TRACKS_PER_MONTH) || 10);
    const theirs = await db.prepare("SELECT COUNT(*) AS n FROM parcel_tracks WHERE shopper_id = ? AND created_at > ?").bind(shopperId, now - 30 * DAY).first();
    if (theirs && theirs.n >= PER_SHOPPER) return { available: true, delivery: null, reason: "limit" };
    // Counted before asking, and only while under the month's allowance (one statement, so two at once can't both slip in).
    const took = await db.prepare(`INSERT INTO parcel_track_uses (month, n) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET n = n + 1 WHERE n < ?`)
      .bind(month, cap).run();
    if (!cap || !took.meta || !took.meta.changes) return { available: true, delivery: null, reason: "limit" };
    const courier = courierCode(dv.carrier);
    res = await ask(env, fetchImpl, `${API}/trackers/track`, { method: "POST", body: JSON.stringify({ trackingNumber: tn, destinationCountryCode: "GB", ...(courier ? { courierCode: [courier] } : {}) }) });
  }
  if (!res.ok) {
    if (mine) return answer(mine);
    return { available: true, delivery: null, reason: "carrier_unavailable" };
  }
  const got = readShip24(res.body, today);
  await db.prepare(`INSERT INTO parcel_tracks (shopper_id, tracking_number, status, at, checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(shopper_id, tracking_number) DO UPDATE SET status = COALESCE(excluded.status, parcel_tracks.status), at = COALESCE(excluded.at, parcel_tracks.at), checked_at = excluded.checked_at`)
    .bind(shopperId, tn, got ? got.status : null, got ? got.at : null, now, now).run();
  return answer(got || mine);
}
