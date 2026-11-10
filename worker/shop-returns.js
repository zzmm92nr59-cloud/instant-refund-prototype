// Each shop's own returns period, and how it wants items sent back: set by the shop in Relay for shops.
//
// Rules (do not weaken):
//  * Relay never makes up a shop's returns period. A shopper is shown a "return by" date or a countdown only when the shop
//    itself set the period here.
//  * Until a shop sets one, Relay still lets a shopper ask for a return for RELAY_RETURN_LIMIT_DAYS after ordering. That is
//    Relay's own limit on starting a return through Relay, said as such, and never shown as the shop's deadline.
//  * The period counts from the day the order was placed, because Relay doesn't know the delivery day of every order. The
//    shop is told so where it sets it, so it can allow for delivery.
//  * "How to send it back" is the shop's own words, shown to its customers as plain text (never as a link or a label).
import { ensureOnce } from "./once.js";

export const RELAY_RETURN_LIMIT_DAYS = 30;
const DAY = 86400000;
const MAX_HOW = 600;

export function ensureShopReturnsTable(db) {
  return ensureOnce(db, "shop-returns", async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS relay_shop_returns (shop TEXT PRIMARY KEY, days INTEGER, how TEXT, updated_at INTEGER NOT NULL)").run();
  });
}

const shape = (r) => ({ days: r && Number.isInteger(r.days) && r.days >= 1 && r.days <= 365 ? r.days : null, how: r && r.how ? String(r.how) : null });

// One shop's settings (shop: its myshopify.com address). Nothing set is { days: null, how: null }.
export async function shopReturns(env, shop) {
  try {
    await ensureShopReturnsTable(env.RELAY_DB);
    return shape(await env.RELAY_DB.prepare("SELECT days, how FROM relay_shop_returns WHERE shop = ?").bind(String(shop || "")).first());
  } catch { return shape(null); }
}

// Several shops at once (for a shopper's list of orders): Map of shop -> settings, only for shops that have set something.
export async function shopReturnsMany(env, shops) {
  const out = new Map(), list = [...new Set((shops || []).map(String))].slice(0, 90);
  if (!list.length) return out;
  try {
    await ensureShopReturnsTable(env.RELAY_DB);
    const rows = (await env.RELAY_DB.prepare(`SELECT shop, days, how FROM relay_shop_returns WHERE shop IN (${list.map(() => "?").join(",")})`).bind(...list).all()).results || [];
    for (const r of rows) out.set(r.shop, shape(r));
  } catch { /* no settings yet */ }
  return out;
}

// Whether a return can still be started for an order placed at `orderedAt`, and what to say about it.
// basis "shop": the shop's own period, so `by` (the last day, YYYY-MM-DD) may be shown to the shopper as the shop's date.
// basis "relay": the shop hasn't said; `by` is only Relay's own limit and must not be shown as a deadline.
// A return can be started all through the `by` day (the app calls it the "Last day"), not only up to the minute the order
// was placed at: the date a shopper is shown is one they can act on.
export function returnWindow(orderedAt, setting, now) {
  const own = Boolean(setting && setting.days);
  const days = own ? setting.days : RELAY_RETURN_LIMIT_DAYS, basis = own ? "shop" : "relay";
  const t = Date.parse(orderedAt);
  if (!Number.isFinite(t)) return { open: false, basis, days, by: null, daysSince: null };
  const by = new Date(t + days * DAY).toISOString().slice(0, 10);
  return { open: now < Date.parse(by + "T00:00:00Z") + DAY, basis, days, by, daysSince: Math.max(0, Math.floor((now - t) / DAY)) };
}

// The shop's words, tidied: no control characters, no more than 8 lines, each trimmed.
const tidyHow = (t) => String(t == null ? "" : t).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim())
  .filter((l, i, a) => l || (i > 0 && a[i - 1])).slice(0, 8).join("\n").trim();

export async function shopReturnsSettings(env, shop) {
  return { ...(await shopReturns(env, shop)), relayLimitDays: RELAY_RETURN_LIMIT_DAYS };
}

// POST from the shop's dashboard: { days, how }. days: 1 to 365 whole days, or null/"" to clear. how: up to 600 characters.
export async function saveShopReturns(env, shop, body, now = Date.now()) {
  if (!body || typeof body !== "object") return [400, { error: "invalid_settings" }];
  const cur = await shopReturns(env, shop);
  let days = cur.days, how = cur.how;
  if ("days" in body) {
    if (body.days === null || body.days === "") days = null;
    else if (Number.isInteger(body.days) && body.days >= 1 && body.days <= 365) days = body.days;
    else return [400, { error: "invalid_days" }];
  }
  if ("how" in body) {
    if (body.how != null && typeof body.how !== "string") return [400, { error: "invalid_how" }];
    const t = tidyHow(body.how);
    if (t.length > MAX_HOW) return [400, { error: "how_too_long" }];
    how = t || null;
  }
  await ensureShopReturnsTable(env.RELAY_DB);
  await env.RELAY_DB.prepare(`INSERT INTO relay_shop_returns (shop, days, how, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(shop) DO UPDATE SET days = excluded.days, how = excluded.how, updated_at = excluded.updated_at`).bind(String(shop), days, how, now).run();
  return [200, { days, how, relayLimitDays: RELAY_RETURN_LIMIT_DAYS }];
}
