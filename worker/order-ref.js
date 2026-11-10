// The order number a shop shows its customer ("#1001"), kept with each order from a connected Shopify shop so the order can
// be found again in the shopper's own emails (see answer-key.js). Shopify's own id for an order (a long number) never
// appears in its emails, so without this the only clues would be the shop, the day and the amount.
//
// The number is saved after the order itself, separately, so a problem here can never stop an order being recorded.
// It lives on the order's own row, so it goes whenever the order goes (a shop removing a customer, or leaving Relay).
import { ensureOnce } from "./once.js";

// "#1001", "BR-1001-UK": what Shopify calls the order's name. Anything else (empty, too long, odd characters) is left out.
export function cleanOrderRef(v) {
  const s = String(v == null ? "" : v).trim();
  return /^[#A-Za-z0-9][A-Za-z0-9#_./ -]{0,39}$/.test(s) && /\d/.test(s) ? s : null;
}

// Databases made before order numbers were kept get the column the first time it's needed.
export function ensureOrderRefColumn(db) {
  return ensureOnce(db, "retailer-orders-order-ref", async () => {
    const cols = ((await db.prepare("PRAGMA table_info(retailer_orders)").all()).results || []).map((c) => c.name);
    if (!cols.includes("order_ref")) {
      try { await db.prepare("ALTER TABLE retailer_orders ADD COLUMN order_ref TEXT").run(); }
      catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } // another request added it first
    }
  });
}

// Never throws: the order is already saved, and the number is only a help for finding it again.
export async function saveOrderRef(db, orderId, ref) {
  const clean = cleanOrderRef(ref);
  if (!clean || !orderId) return false;
  try {
    await ensureOrderRefColumn(db);
    await db.prepare("UPDATE retailer_orders SET order_ref = ? WHERE id = ?").bind(clean, orderId).run();
    return true;
  } catch (e) {
    console.warn("Couldn't keep the order number", String(e && e.message || e).slice(0, 120));
    return false;
  }
}

// What an order comes to now, once it has changed since it was placed (a swap through Relay, the shop editing it, a refund).
// The order's own amount stays what it came to when it was placed: its confirmation email says that amount, so it is what
// the order is matched to the shopper's receipt by (and what the reader is checked against, answer-key.js). null: the
// order hasn't changed, as far as Relay knows. Databases made before this was kept get the column the first time it's needed.
export function ensureOrderNowColumn(db) {
  return ensureOnce(db, "retailer-orders-amount-now", async () => {
    const cols = ((await db.prepare("PRAGMA table_info(retailer_orders)").all()).results || []).map((c) => c.name);
    if (!cols.includes("current_amount_minor")) {
      try { await db.prepare("ALTER TABLE retailer_orders ADD COLUMN current_amount_minor INTEGER").run(); }
      catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } // another request added it first
    }
  });
}

// minor: pence, or null for "not changed". Never throws: the order is already saved, and this only corrects what's shown.
export async function saveOrderAmountNow(db, orderId, minor) {
  if (!orderId || !(minor === null || (Number.isSafeInteger(minor) && minor >= 0))) return false;
  try {
    await ensureOrderNowColumn(db);
    await db.prepare("UPDATE retailer_orders SET current_amount_minor = ? WHERE id = ?").bind(minor, orderId).run();
    return true;
  } catch (e) {
    console.warn("Couldn't keep what the order comes to now", String(e && e.message || e).slice(0, 120));
    return false;
  }
}
