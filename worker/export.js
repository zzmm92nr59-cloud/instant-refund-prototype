// "Download my data": everything Relay keeps about the signed-in shopper, as one JSON file they can keep (the right to a
// copy of your data, and to take it elsewhere). Only the shopper's own rows, and never a secret: no keys to their inbox,
// no session or sign-in codes, no two-step secret, no passkey keys and no payment-company references. Tables that a
// shopper has never used may not exist yet, so each part is read on its own and an empty part is simply empty.

import { exportPhone } from "./phone.js";
import { sharedForExport } from "./shared-emails.js";
import { crossSwapsForExport } from "./cross-swap.js";
import { deliveryForExport } from "./delivery.js";
import { auctionsForExport } from "./auctions.js";
import { ensureBankColumns } from "./bank.js";
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

export async function exportShopperData(env, shopper, now = Date.now()) {
  const db = env.RELAY_DB;
  const rows = async (sql, ...args) => {
    try { return (await db.prepare(sql).bind(...args).all()).results || []; }
    catch (e) { if (/no such table|no such column/i.test(String(e && e.message))) return []; throw e; }
  };
  const one = async (sql, ...args) => (await rows(sql, ...args))[0] || null;
  const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const id = shopper.id;

  const account = await one("SELECT email, created_at AS createdAt FROM shoppers WHERE id = ?", id);
  const profile = await one("SELECT name, photo_type AS photoType, photo_data AS photoData, updated_at AS updatedAt FROM shopper_profiles WHERE shopper_id = ?", id);
  const interests = await one("SELECT interests, updated_at AS updatedAt FROM shopper_interests WHERE shopper_id = ?", id);
  const tips = await one("SELECT seen, updated_at AS updatedAt FROM shopper_tips WHERE shopper_id = ?", id);
  const mail = await one("SELECT provider, google_email AS address, connected_at AS connectedAt, last_scan_at AS lastScanAt FROM gmail_connections WHERE shopper_id = ?", id);
  // Other inboxes the shopper connected (kept as "<id>~<n>").
  const moreMail = (await rows("SELECT shopper_id AS box, provider, google_email AS address, connected_at AS connectedAt, last_scan_at AS lastScanAt FROM gmail_connections WHERE shopper_id LIKE ? ORDER BY shopper_id", id + "~%"))
    .filter((m) => /~\d{1,2}$/.test(m.box));
  const captured = await rows("SELECT id, status, details, created_at AS createdAt FROM captured_receipts WHERE shopper_id = ? AND status <> 'not_receipt' ORDER BY created_at", id);
  const notReceipts = await one("SELECT COUNT(*) AS n FROM captured_receipts WHERE shopper_id = ? AND status = 'not_receipt'", id);
  // twoStep below is the authenticator app; codes by text are under phone.
  const totp = await one("SELECT enabled, enabled_at AS enabledAt FROM auth_totp WHERE shopper_id = ?", id);
  const devices = await one("SELECT COUNT(*) AS n FROM push_subscriptions WHERE shopper_id = ?", id);
  const sessions = await rows("SELECT created_at AS createdAt, expires_at AS expiresAt FROM auth_sessions WHERE shopper_id = ? AND expires_at > ?", id, now);
  await ensureBankColumns(db);   // TrueLayer's label column (added 17 Nov 2026), so the payments below are always read
  const myRequests = "(SELECT id FROM resale_requests WHERE asker_id = ? OR listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?))";

  return {
    about: "Everything Relay keeps about you, as of " + iso(now) + ". Receipts are the details Relay read from your emails; the emails themselves stay in your inbox.",
    account: account && { email: account.email, createdAt: iso(account.createdAt) },
    profile: profile && { name: profile.name || null, photo: profile.photoData ? "data:" + (profile.photoType || "image/jpeg") + ";base64," + profile.photoData : null, updatedAt: iso(profile.updatedAt) },
    // What they said they shop for (Profile, Your interests).
    interests: interests && { interests: parse(interests.interests) || [], updatedAt: iso(interests.updatedAt) },
    // Which first-run tips they've seen.
    tips: tips && { seen: parse(tips.seen) || [], updatedAt: iso(tips.updatedAt) },
    // The delivery address kept for filling in shops' checkouts, and each shop it was sent to.
    delivery: await deliveryForExport(env, id),
    // Auctions bid on (with the most they'd pay) and anything won or offered to them.
    auctions: await auctionsForExport(env, id),
    signIn: {
      activeSessions: sessions.map((s) => ({ startedAt: iso(s.createdAt), endsAt: iso(s.expiresAt) })),
      passkeys: (await rows("SELECT name, created_at AS createdAt, last_used_at AS lastUsedAt FROM auth_passkeys WHERE shopper_id = ?", id))
        .map((p) => ({ name: p.name, createdAt: iso(p.createdAt), lastUsedAt: iso(p.lastUsedAt) })),
      twoStep: totp ? { on: Boolean(totp.enabled), since: iso(totp.enabledAt) } : { on: false },
      // The phone number on the account, and whether sign-in codes are texted to it.
      phone: await exportPhone(env, id),
    },
    emailPermission: (await rows("SELECT version, accepted_at AS acceptedAt, withdrawn_at AS withdrawnAt FROM shopper_consents WHERE shopper_id = ? ORDER BY accepted_at", id))
      .map((c) => ({ version: c.version, agreedAt: iso(c.acceptedAt), withdrawnAt: iso(c.withdrawnAt) })),
    emailConnection: mail && {
      provider: mail.provider === "microsoft" ? "Outlook" : "Gmail", address: mail.address || null,
      connectedAt: iso(mail.connectedAt), lastCheckedAt: iso(mail.lastScanAt),
      earlierYearsRead: (await rows("SELECT year FROM gmail_history_years WHERE shopper_id = ? AND done_at IS NOT NULL ORDER BY year DESC", id)).map((y) => y.year),
    },
    otherEmailConnections: moreMail.map((m) => ({ inbox: Number(m.box.split("~")[1]), provider: m.provider === "microsoft" ? "Outlook" : "Gmail", address: m.address || null,
      connectedAt: iso(m.connectedAt), lastCheckedAt: iso(m.lastScanAt) })),
    receipts: captured.map((r) => ({ id: r.id, status: r.status, capturedAt: iso(r.createdAt), ...(parse(r.details) || {}) })),
    emailsLookedAtButNotKept: notReceipts ? notReceipts.n : 0,
    // Codes to show or scan that Relay kept from your emails (a return barcode, a drop-off QR code, a ticket): what each is
    // for, the shop's words, any date the email gave, and the picture itself when Relay could keep it.
    codesToShow: (await rows("SELECT receipt_id AS fromEmail, purpose, kind, value, words, deadline, day, type, data, created_at AS at FROM receipt_codes WHERE shopper_id = ? ORDER BY created_at, receipt_id, idx", id))
      .map((c) => ({ fromEmail: c.fromEmail, purpose: c.purpose, kind: c.kind || null, number: c.value || null, shopsWords: parse(c.words) || [], deadline: c.deadline || null, eventDay: c.day || null,
        picture: c.data ? "data:" + c.type + ";base64," + c.data : null, keptAt: iso(c.at) })),
    yourChoices: {
      storeCategories: (await rows("SELECT store_key AS store, category, promo FROM receipt_learning WHERE shopper_id = ?", id))
        .map((l) => ({ store: l.store, category: l.category || null, justPromotions: Boolean(l.promo) })),
      itemsMarked: await rows("SELECT receipt_id AS receiptId, item_index AS item, status FROM receipt_item_marks WHERE shopper_id = ?", id),
      // What you corrected on receipts Relay read wrong.
      fixes: (await rows("SELECT receipt_id AS receiptId, fields, updated_at AS updatedAt FROM receipt_fixes WHERE shopper_id = ?", id))
        .map((f) => ({ receiptId: f.receiptId, corrected: parse(f.fields), changedAt: iso(f.updatedAt) })),
      // Receipts you said were (or weren't) a gift, and who for when you said.
      gifts: (await rows("SELECT receipt_id AS receiptId, is_gift AS isGift, recipient, updated_at AS updatedAt FROM receipt_gifts WHERE shopper_id = ?", id))
        .map((g) => ({ receiptId: g.receiptId, gift: Boolean(g.isGift), for: g.recipient || null, changedAt: iso(g.updatedAt) })),
      // Receipts you said were one order, or different orders (worker/order-joins.js).
      sameOrDifferentOrders: (await rows("SELECT a_id AS a, b_id AS b, kind, created_at AS at FROM receipt_joins WHERE shopper_id = ?", id))
        .map((j) => ({ receipts: [j.a, j.b], youSaid: j.kind === "same" ? "same order" : "different orders", at: iso(j.at) })),
      returnReminders: (await rows("SELECT receipt_id AS receiptId, title, deadline, remind_at AS remindAt, sent_at AS sentAt FROM return_reminders WHERE shopper_id = ?", id))
        .map((r) => ({ receiptId: r.receiptId, title: r.title, deadline: r.deadline, remindAt: iso(r.remindAt), sentAt: iso(r.sentAt) })),
    },
    // Emails you chose to send to Relay from a receipt it read wrong, as kept (details hidden), until they're deleted.
    emailsSentToRelay: await sharedForExport(env, id, now),
    // AI help: whether it's on, and what the AI read from emails Relay's own reader wasn't sure about.
    aiHelp: await (async () => {
      const on = await one("SELECT on_since AS since FROM ai_reading WHERE shopper_id = ?", id);
      return { on: Boolean(on), since: on ? iso(on.since) : null,
        readings: (await rows("SELECT receipt_id AS receiptId, fields, failed, created_at AS at FROM receipt_ai_reads WHERE shopper_id = ? ORDER BY created_at", id))
          .map((r) => ({ receiptId: r.receiptId, read: parse(r.fields), couldNotRead: r.failed || null, at: iso(r.at) })) };
    })(),
    // Banks and cards connected through open banking (never their passwords or keys), and the payments read from them.
    banks: {
      connections: (await rows("SELECT id, bank, connected_at AS at, synced_at AS synced FROM bank_links WHERE shopper_id = ? ORDER BY connected_at", id))
        .map((r) => ({ id: r.id, bank: r.bank, connectedAt: iso(r.at), lastRead: iso(r.synced) })),
      // Which of each connection's cards and accounts the shopper said are theirs.
      cards: (await rows("SELECT connection_id AS connection, name, last4, mine, seen_at AS at FROM bank_cards WHERE shopper_id = ? ORDER BY connection_id, rowid", id).catch(() => []))
        .map((r) => ({ connection: r.connection, name: r.name, last4: r.last4, yours: r.mine === 1 ? true : r.mine === 0 ? false : null, lastSeen: iso(r.at) })),
      payments: (await rows("SELECT account, paid_on AS date, amount_minor AS pence, currency, description, merchant, classification AS bankLabel, receipt_id AS receiptId, match FROM bank_payments WHERE shopper_id = ? ORDER BY paid_on", id)),
      // Payments you said weren't yours, and shops you said nothing from is yours.
      notMine: (await rows("SELECT kind, key, created_at AS at FROM bank_not_mine WHERE shopper_id = ? ORDER BY created_at", id).catch(() => [])).map((r) => ({ kind: r.kind, key: r.key, at: iso(r.at) }))
    },
    // AI for picks: whether it's on, and what the AI made of each thing you bought (only item names were sent).
    aiForPicks: await (async () => {
      const on = await one("SELECT on_since AS since FROM picks_ai WHERE shopper_id = ?", id);
      return { on: Boolean(on), since: on ? iso(on.since) : null,
        items: (await rows("SELECT name_key AS item, data, created_at AS at FROM item_kinds WHERE shopper_id = ? ORDER BY created_at", id)).map((r) => ({ item: r.item, read: parse(r.data), at: iso(r.at) })) };
    })(),
    // Live parcel tracking: each tracking number Relay asked the carrier about (through Ship24), and what it said.
    parcels: (await rows("SELECT tracking_number AS trackingNumber, status, at, checked_at AS checkedAt FROM parcel_tracks WHERE shopper_id = ? ORDER BY created_at", id)).map((r) => ({ ...r, checkedAt: iso(r.checkedAt) })),
    // Return tracking: each receipt you said you'd sent back, with the return's tracking number and carrier if you gave
    // them (what the carriers and shops said is in the emails above, and in parcels for the carrier's own tracking).
    returnsSentBack: (await rows("SELECT receipt_id AS receiptId, tracking_number AS trackingNumber, carrier, sent_on AS sentOn, created_at AS createdAt, updated_at AS updatedAt FROM return_tracks WHERE shopper_id = ? ORDER BY created_at", id))
      .map((r) => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) })),
    // The help chat keeps no conversations: only how many messages you sent each day, and whether you asked for a person.
    helpChat: (await rows("SELECT day, messages, handoffs FROM support_chat_usage WHERE shopper_id = ? ORDER BY day", id)),
    alerts: {
      devicesWithNotifications: devices ? devices.n : 0,
      watchedProducts: (await rows("SELECT product, variant, store, baseline_minor AS priceWhenWatchedPence, last_seen_minor AS lastSeenPence, created_at AS createdAt FROM price_watches WHERE shopper_id = ?", id))
        .map((w) => ({ ...w, createdAt: iso(w.createdAt) })),
      watchedShops: (await rows("SELECT store FROM store_optins WHERE shopper_id = ?", id)).map((s) => s.store),
      allShopsOffers: Boolean((await one("SELECT all_shops FROM alert_prefs WHERE shopper_id = ?", id) || {}).all_shops),
    },
    savedCard: await one("SELECT brand, last4, exp_month AS expMonth, exp_year AS expYear, wallet FROM relay_cards WHERE shopper_id = ?", id),
    returnsAndSwaps: {
      returns: (await rows("SELECT id, shop, order_id AS orderId, item_title AS item, quantity, price_minor AS pricePence, reason, return_ref AS reference, status, carrier, tracking_number AS trackingNumber, refund_minor AS refundPence, created_at AS createdAt FROM relay_returns WHERE shopper_id = ?", id))
        .map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
      swaps: (await rows("SELECT id, shop, order_id AS orderId, from_title AS fromItem, to_title AS toItem, quantity, status, created_at AS createdAt FROM relay_exchanges WHERE shopper_id = ?", id))
        .map((x) => ({ ...x, createdAt: iso(x.createdAt) })),
      payments: (await rows("SELECT shop, order_id AS orderId, amount_minor AS amountPence, currency, status, created_at AS createdAt FROM relay_swap_payments WHERE shopper_id = ?", id))
        .map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
      returnLabels: (await rows("SELECT return_id AS returnId, created_at AS createdAt FROM relay_return_labels WHERE shopper_id = ?", id))
        .map((l) => ({ returnId: l.returnId, createdAt: iso(l.createdAt) })),
      // Items sent back to one shop for something from another shop on Relay.
      swapsWithOtherShops: await crossSwapsForExport(env, id),
    },
    // When you searched by photo, kept 2 days for the daily limit. The pictures themselves are never kept.
    photoSearches: (await rows("SELECT created_at AS at FROM photo_search_uses WHERE shopper_id = ? ORDER BY created_at", id)).map((r) => iso(r.at)),
    // Relay's team only: when they searched or read their own Outlook inbox (kept 2 days for the daily limits; nothing from the emails).
    outlookSearches: (await rows("SELECT kind, created_at AS at FROM outlook_search_uses WHERE shopper_id = ? ORDER BY created_at", id)).map((r) => ({ kind: r.kind, at: iso(r.at) })),
    swapAndSell: {
      listings: (await rows("SELECT id, title, store, size, condition, ask_pence AS askPence, swap_ok AS swapOk, note, area, status, created_at AS createdAt FROM resale_listings WHERE seller_id = ?", id))
        .map((l) => ({ ...l, swapOk: Boolean(l.swapOk), createdAt: iso(l.createdAt) })),
      requests: (await rows(`SELECT id, listing_id AS listingId, kind, message, status, created_at AS createdAt FROM resale_requests WHERE id IN ${myRequests}`, id, id))
        .map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
      messages: (await rows(`SELECT request_id AS requestId, CASE WHEN sender_id = ? THEN 'you' ELSE 'the other member' END AS sentBy, body, created_at AS createdAt FROM resale_messages WHERE request_id IN ${myRequests} ORDER BY created_at`, id, id, id))
        .map((m) => ({ ...m, createdAt: iso(m.createdAt) })),
      reportsYouMade: (await rows("SELECT request_id AS requestId, reason, created_at AS createdAt FROM resale_reports WHERE reporter_id = ?", id))
        .map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
      listingsYouReported: (await rows("SELECT listing_id AS listingId, reason, created_at AS createdAt FROM resale_listing_reports WHERE reporter_id = ?", id))
        .map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    },
    inStorePurchaseSuggestions: (await rows("SELECT order_id AS orderId, brand, last4, amount_minor AS amountPence, currency, paid_at AS paidAt, store, status FROM square_instore_suggestions WHERE email_hash = ?", shopper.emailHash)),
    ordersFromConnectedShops: (await rows("SELECT order_id AS orderId FROM retailer_order_emails WHERE email_hash = ?", shopper.emailHash)).map((o) => o.orderId),
  };
}

export async function handleExportRoute(request, env, url, cors, shopper, o = {}) {
  if (url.pathname !== "/relay/my/export" || request.method !== "GET") return null;
  return json(await exportShopperData(env, shopper, o.now || Date.now()), 200, cors);
}
