// The Relay health page, for Relay's admins only: how well emails are being read and how the app is being used, as counts.
//
// Rules (do not weaken):
//  * Counts only. Nothing from a single receipt (no items, prices, order numbers or email text) and nothing that names a
//    shopper. Google lets people see data that came from someone's Gmail only when it's aggregated and used to run the app
//    ("internal operations"), so for other people's receipts that is all this page shows.
//  * A shop is named only once MIN_SHOPPERS_PER_SHOP different shoppers have receipts from it, so a count can never point
//    at what one person bought (the same rule as the shops' own dashboard). Personal email addresses (a receipt someone
//    forwarded to themselves) are never named.
//  * The admin's own receipts are theirs, so "Your own receipts" breaks those down by shop with no minimum: that's how the
//    reader is checked now, while there are few shoppers.
//  * Read-only. Anyone who isn't an admin gets "not found", as for the other admin routes.
//  * "Checked against shops' own records" (answer-key.js) follows the same rules: counts, shops named only from
//    MIN_SHOPPERS_PER_SHOP shoppers, and only the admin's own orders in detail.
import { isAdmin } from "./resale-admin.js";
import { PERSONAL_MAIL } from "./receipt-category.js";
import { PARSER_VERSION } from "./gmail.js";
import { chatAvailable } from "./support-chat.js";
import { answerKey } from "./answer-key.js";
import { SHARE_DAYS } from "./shared-emails.js";
import { aiAvailable } from "./ai-reader.js";

export const MIN_SHOPPERS_PER_SHOP = 3;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// GET /relay/my/admin/health. Returns null for any other path.
export async function handleHealthRoute(path, method, env, cors, shopper, o) {
  if (path !== "/relay/my/admin/health") return null;
  if (!isAdmin(env, shopper) || method !== "GET") return json({ error: "not_found" }, 404, cors);
  return json(await relayHealth(env, shopper, (o && o.now) || Date.now()), 200, cors);
}

export async function relayHealth(env, me, now = Date.now()) {
  const db = env.RELAY_DB;
  // A table nobody has used yet doesn't exist yet: its part is simply empty.
  const all = async (sql, ...a) => {
    try { return (await db.prepare(sql).bind(...a).all()).results || []; }
    catch (e) { if (/no such (table|column)/i.test(String(e && e.message))) return []; throw e; }
  };
  const one = async (sql, ...a) => (await all(sql, ...a))[0] || {};
  const n = (v) => Number(v) || 0;
  const d1 = now - DAY, d7 = now - 7 * DAY, d30 = now - 30 * DAY;
  // The last 14 days, today included, as dates.
  const dates = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * DAY).toISOString().slice(0, 10));
  const start = Date.parse(dates[0] + "T00:00:00Z");
  const KIND = "json_extract(details, '$.kind')", DOMAIN = "lower(json_extract(details, '$.retailer.domain'))";
  // What the reader found in an email, for the rows that are purchases.
  const QUALITY = `COUNT(*) AS receipts,
    SUM(json_extract(details, '$.confidence') = 'high') AS high, SUM(json_extract(details, '$.confidence') = 'medium') AS medium,
    SUM(json_extract(details, '$.confidence') = 'low') AS low,
    SUM(status = 'confirmed') AS confirmed, SUM(status = 'dismissed') AS dismissed,
    SUM(json_extract(details, '$.totalPence') IS NULL) AS noTotal,
    SUM(COALESCE(json_array_length(json_extract(details, '$.items')), 0) = 0) AS noItems,
    SUM(json_extract(details, '$.pasted') IS NOT NULL) AS pasted`;
  const quality = (r) => ({ receipts: n(r.receipts), high: n(r.high), medium: n(r.medium), low: n(r.low), confirmed: n(r.confirmed), dismissed: n(r.dismissed),
    noTotal: n(r.noTotal), noItems: n(r.noItems), pasted: n(r.pasted) });
  // A shop's problems: removed as not theirs, no total found, read with low confidence, added by hand, fixed by the shopper.
  const problems = (s) => s.dismissed + s.noTotal + s.low + s.pasted + (s.fixed || 0);

  const [people, sessions, signIns, inboxes, inboxPeople, checked, jobs, jobErrors, emails, kinds, purchases, purchases7, versions, unread,
    learned, marks, gifts, giftShoppers, history, perDay, shops, mine, returns, swaps, payments, labels, shopify, shopifyTest, square, pushes, watches, codeFails,
    fixes, fixReaders, fixShops, myFixes, chat, shared, aiOn, ai] = await Promise.all([
    one("SELECT COUNT(*) AS total, SUM(created_at >= ?) AS week, SUM(created_at >= ?) AS month FROM shoppers", d7, d30),
    one("SELECT COUNT(DISTINCT shopper_id) AS n FROM auth_sessions WHERE expires_at > ?", now),
    one("SELECT COUNT(DISTINCT shopper_id) AS n FROM auth_sessions WHERE created_at >= ?", d7),
    all("SELECT COALESCE(provider, 'google') AS provider, COUNT(*) AS n FROM gmail_connections GROUP BY COALESCE(provider, 'google')"),
    // People with at least one inbox (a shopper's other inboxes are kept as "<id>~<n>").
    one("SELECT COUNT(DISTINCT CASE WHEN instr(shopper_id, '~') > 0 THEN substr(shopper_id, 1, instr(shopper_id, '~') - 1) ELSE shopper_id END) AS n FROM gmail_connections"),
    one("SELECT SUM(last_scan_at >= ?) AS today, SUM(last_scan_at IS NULL OR last_scan_at < ?) AS stale, MAX(last_scan_at) AS latest, SUM(connected_at >= ?) AS newWeek FROM gmail_connections", d1, d1, d7),
    all("SELECT state, COUNT(*) AS n FROM mail_scan_jobs WHERE updated_at >= ? GROUP BY state", d7),
    all("SELECT error, COUNT(*) AS n FROM mail_scan_jobs WHERE error IS NOT NULL AND updated_at >= ? GROUP BY error ORDER BY n DESC LIMIT 8", d7),
    one("SELECT COUNT(*) AS looked, SUM(status = 'not_receipt') AS notReceipts, SUM(created_at >= ?) AS week FROM captured_receipts", d7),
    all(`SELECT ${KIND} AS kind, COUNT(*) AS n FROM captured_receipts WHERE status <> 'not_receipt' GROUP BY ${KIND}`),
    one(`SELECT ${QUALITY} FROM captured_receipts WHERE status <> 'not_receipt' AND ${KIND} = 'receipt'`),
    one(`SELECT ${QUALITY} FROM captured_receipts WHERE status <> 'not_receipt' AND ${KIND} = 'receipt' AND created_at >= ?`, d7),
    all("SELECT COALESCE(json_extract(details, '$.parserVersion'), 0) AS v, COUNT(*) AS n FROM captured_receipts GROUP BY v ORDER BY v DESC"),
    one("SELECT COUNT(*) AS n FROM captured_receipts WHERE json_extract(details, '$.unread') = 1"),
    one("SELECT SUM(category IS NOT NULL) AS groups, SUM(promo = 1) AS promos, COUNT(DISTINCT shopper_id) AS people FROM receipt_learning"),
    one("SELECT COUNT(*) AS n, COUNT(DISTINCT shopper_id) AS people FROM receipt_item_marks WHERE status = 'returning'"),
    one("SELECT COUNT(*) AS n FROM receipt_gifts WHERE is_gift = 1"),
    one("SELECT COUNT(DISTINCT shopper_id) AS n FROM receipt_gifts WHERE is_gift = 1"),
    one("SELECT COUNT(*) AS n FROM gmail_history_years WHERE done_at IS NOT NULL"),
    // Emails read each day (UK winter time is UTC) for the last 14 days, by the day Relay read them.
    all("SELECT date(created_at / 1000, 'unixepoch') AS d, SUM(status <> 'not_receipt') AS kept, SUM(status = 'not_receipt') AS skipped FROM captured_receipts WHERE created_at >= ? GROUP BY d", start),
    all(`SELECT ${DOMAIN} AS domain, COUNT(DISTINCT shopper_id) AS people, ${QUALITY} FROM captured_receipts WHERE status <> 'not_receipt' AND ${KIND} = 'receipt' AND ${DOMAIN} IS NOT NULL GROUP BY ${DOMAIN} HAVING COUNT(DISTINCT shopper_id) >= ?`, MIN_SHOPPERS_PER_SHOP),
    all(`SELECT ${DOMAIN} AS domain, ${QUALITY} FROM captured_receipts WHERE shopper_id = ? AND status <> 'not_receipt' AND ${KIND} = 'receipt' GROUP BY ${DOMAIN}`, me.id),
    all("SELECT status, COUNT(*) AS n FROM relay_returns GROUP BY status"),
    all("SELECT status, COUNT(*) AS n FROM relay_exchanges GROUP BY status"),
    all("SELECT status, test_mode AS test, COUNT(*) AS n FROM relay_swap_payments GROUP BY status, test_mode"),
    one("SELECT COUNT(*) AS n FROM relay_return_labels"),
    one("SELECT COUNT(*) AS n FROM shopify_shops"),
    one("SELECT COUNT(*) AS n FROM shopify_shop_plan WHERE test_shop = 1 AND domain IN (SELECT domain FROM shopify_shops)"),
    one("SELECT COUNT(*) AS n FROM square_merchants"),
    one("SELECT COUNT(*) AS n, COUNT(DISTINCT shopper_id) AS people FROM push_subscriptions"),
    one("SELECT COUNT(*) AS n, COUNT(DISTINCT shopper_id) AS people FROM price_watches"),
    one("SELECT COUNT(*) AS n FROM auth_code_failures WHERE created_at >= ?", d1),
    // "Fix this receipt": which parts shoppers corrected, which reader read them, and at which shops.
    one("SELECT COUNT(*) AS n, SUM(shop) AS shop, SUM(total) AS total, SUM(date) AS date, SUM(items) AS items, COUNT(DISTINCT shopper_id) AS people, SUM(updated_at >= ?) AS week FROM receipt_fixes", d7),
    all("SELECT COALESCE(reader, 0) AS v, COUNT(*) AS n FROM receipt_fixes GROUP BY v ORDER BY v DESC"),
    all("SELECT domain, COUNT(*) AS n FROM receipt_fixes WHERE domain IS NOT NULL GROUP BY domain"),
    all("SELECT domain, COUNT(*) AS n FROM receipt_fixes WHERE shopper_id = ? GROUP BY domain", me.id),
    // The help chat keeps only counts per shopper per day (support-chat.js).
    one("SELECT COALESCE(SUM(messages), 0) AS m, COALESCE(SUM(handoffs), 0) AS h, COUNT(DISTINCT shopper_id) AS people, COALESCE(SUM(CASE WHEN day = ? THEN messages END), 0) AS today FROM support_chat_usage WHERE day >= ?",
      dates[13], dates[7]),
    // Emails shoppers chose to send to Relay (shared-emails.js): how many are kept, and how many nobody has read yet.
    one("SELECT COUNT(*) AS kept, SUM(looked_at IS NULL) AS waiting, SUM(created_at >= ?) AS week, COUNT(DISTINCT shopper_id) AS people FROM shared_emails WHERE expires_at > ?", d7, now),
    // AI help (ai-reader.js): who has it on, and for each part whether the AI filled a gap (1), agreed with the rules (2) or
    // differed from them (3).
    one("SELECT COUNT(*) AS n FROM ai_reading"),
    one(`SELECT COUNT(*) AS n, SUM(created_at >= ?) AS week, SUM(fields IS NULL) AS failed, SUM(not_purchase) AS notPurchase,
      ${["shop", "total", "date", "number", "items"].map((k) => `SUM(${k} = 1) AS ${k}1, SUM(${k} = 2) AS ${k}2, SUM(${k} = 3) AS ${k}3`).join(", ")} FROM receipt_ai_reads`, d7)
  ]);
  // A problem working this part out never takes the rest of the page with it (the page says it couldn't be checked).
  const checkedByShops = await answerKey(env, me, now, { minShoppers: MIN_SHOPPERS_PER_SHOP })
    .catch((e) => { console.error("Answer key failed", String(e && e.message || e).slice(0, 160)); return null; });

  // Fixes count against a shop only where the shop is already named (from enough people), or among the admin's own.
  const fixedAt = (list) => new Map(list.map((r) => [r.domain, n(r.n)]));
  const allFixed = fixedAt(fixShops), myFixed = fixedAt(myFixes);
  const shopRow = (r, fixedMap) => ({ domain: r.domain, ...(r.people != null ? { people: n(r.people) } : {}), ...quality(r), fixed: fixedMap.get(r.domain) || 0 });
  const named = (r) => r.domain && !PERSONAL_MAIL.test(r.domain);
  const byProblems = (a, b) => problems(b) / Math.max(1, b.receipts) - problems(a) / Math.max(1, a.receipts) || b.receipts - a.receipts;
  const days = dates.map((day) => { const r = perDay.find((x) => x.d === day) || {}; return { day, kept: n(r.kept), skipped: n(r.skipped) }; });
  const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r.status || "unknown", n(r.n)]));
  const mineList = mine.map((r) => shopRow(r, myFixed));
  return {
    generatedAt: new Date(now).toISOString(),
    minShoppersPerShop: MIN_SHOPPERS_PER_SHOP,
    people: { shoppers: n(people.total), newThisWeek: n(people.week), newThisMonth: n(people.month), signedIn: n(sessions.n), signedInThisWeek: n(signIns.n) },
    inboxes: {
      gmail: n((inboxes.find((r) => r.provider === "google") || {}).n), outlook: n((inboxes.find((r) => r.provider === "microsoft") || {}).n),
      shoppers: n(inboxPeople.n), checkedToday: n(checked.today), notCheckedToday: n(checked.stale),
      lastChecked: checked.latest ? new Date(n(checked.latest)).toISOString() : null, newThisWeek: n(checked.newWeek),
      scansThisWeek: Object.fromEntries(jobs.map((r) => [r.state, n(r.n)])), scanErrorsThisWeek: jobErrors.map((r) => ({ error: String(r.error).slice(0, 60), count: n(r.n) }))
    },
    reading: {
      readerVersion: PARSER_VERSION,
      emailsLookedAt: n(emails.looked), notReceipts: n(emails.notReceipts), emailsThisWeek: n(emails.week),
      kinds: Object.fromEntries(kinds.map((r) => [r.kind || "unknown", n(r.n)])),
      purchases: quality(purchases), purchasesThisWeek: quality(purchases7),
      byReader: versions.map((r) => ({ version: n(r.v), emails: n(r.n) })),
      waitingToBeRead: n(unread.n),
      shoppersTaught: { groupsChanged: n(learned.groups), shopsMarkedPromotions: n(learned.promos), people: n(learned.people) },
      itemsMarkedReturning: n(marks.n),
      fixedByShoppers: { receipts: n(fixes.n), shop: n(fixes.shop), total: n(fixes.total), date: n(fixes.date), items: n(fixes.items), people: n(fixes.people),
        thisWeek: n(fixes.week), byReader: fixReaders.map((r) => ({ version: n(r.v), receipts: n(r.n) })) },
      days
    },
    // Shops with the most problems for their size, among shops at least MIN_SHOPPERS_PER_SHOP shoppers bought from.
    shops: shops.map((r) => shopRow(r, allFixed)).filter(named).sort(byProblems).slice(0, 12),
    mine: { receipts: mineList.reduce((s, r) => s + r.receipts, 0), shops: mineList.filter(named).sort(byProblems).slice(0, 15),
      personalMail: mineList.filter((r) => r.domain && PERSONAL_MAIL.test(r.domain)).reduce((s, r) => s + r.receipts, 0),
      noShop: mineList.filter((r) => !r.domain).reduce((s, r) => s + r.receipts, 0) },
    returnsAndSwaps: { returns: byStatus(returns), swaps: byStatus(swaps), labels: n(labels.n),
      payments: payments.map((r) => ({ status: r.status, test: Boolean(n(r.test)), count: n(r.n) })) },
    extras: { gifts: n(gifts.n), giftGivers: n(giftShoppers.n), earlierYearsRead: n(history.n),
      notificationDevices: n(pushes.n), notificationPeople: n(pushes.people), priceWatches: n(watches.n), watchers: n(watches.people) },
    shopsConnected: { shopify: n(shopify.n), shopifyTest: n(shopifyTest.n), square: n(square.n) },
    security: { wrongCodesToday: n(codeFails.n) },
    helpChat: { on: chatAvailable(env), messagesToday: n(chat.today), messagesThisWeek: n(chat.m), handoffsThisWeek: n(chat.h), peopleThisWeek: n(chat.people) },
    sharedEmails: { kept: n(shared.kept), waiting: n(shared.waiting), thisWeek: n(shared.week), people: n(shared.people), keptDays: SHARE_DAYS },
    aiReader: { on: aiAvailable(env), shoppersOn: n(aiOn.n), reads: n(ai.n), thisWeek: n(ai.week), failed: n(ai.failed), notPurchase: n(ai.notPurchase),
      parts: Object.fromEntries(["shop", "total", "date", "number", "items"].map((k) => [k, { filled: n(ai[k + "1"]), agreed: n(ai[k + "2"]), differed: n(ai[k + "3"]) }])) },
    checkedByShops
  };
}
