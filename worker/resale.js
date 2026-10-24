// Relay Resale (v1): members list items from their own captured receipts, browse each other's
// listings and ask to buy or swap. NO MONEY MOVES THROUGH RELAY and nothing is shipped: v1 only
// matches people. Everything here runs behind the shopper sign-in.
//
// Privacy rules enforced here:
//  - A listing can only be made from a receipt the signed-in shopper owns.
//  - The listing title and store come from the receipt, never from the request body.
//  - Other members never see the seller's identity, email, order number, address or receipt id.
//    Buyers and sellers are only ever shown to each other as "Member N".
//  - Only the seller sees who asked about their listing; only the asker sees their own requests.

const DAY = 24 * 60 * 60 * 1000;
import { ADMIN_TABLE_SQL, handleResaleAdminRoute, isBlocked } from "./resale-admin.js";
export const CONDITIONS = ["new_with_tags", "like_new", "good", "fair"];
const MAX_ACTIVE_LISTINGS = 20, MAX_REQUESTS_PER_DAY = 30, MAX_ASK_PENCE = 500000;

export async function ensureResaleTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS resale_listings (
       id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, receipt_id TEXT NOT NULL, item_index INTEGER NOT NULL,
       title TEXT NOT NULL, store TEXT, currency TEXT, size TEXT, condition TEXT NOT NULL,
       ask_pence INTEGER, swap_ok INTEGER NOT NULL DEFAULT 0, note TEXT, has_image INTEGER NOT NULL DEFAULT 0,
       status TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_resale_status ON resale_listings(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_resale_seller ON resale_listings(seller_id, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_resale_one_active ON resale_listings(receipt_id, item_index) WHERE status = 'active'`,
    `CREATE TABLE IF NOT EXISTS resale_requests (
       id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, asker_id TEXT NOT NULL, kind TEXT NOT NULL,
       offered_listing_id TEXT, message TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL,
       UNIQUE (listing_id, asker_id))`,
    `CREATE INDEX IF NOT EXISTS idx_resale_req_asker ON resale_requests(asker_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS resale_messages (
       id TEXT PRIMARY KEY, request_id TEXT NOT NULL, sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_resale_msg ON resale_messages(request_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS resale_reports (
       id TEXT PRIMARY KEY, request_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL)`,
    ...ADMIN_TABLE_SQL
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

const MY_REQUESTS = "(SELECT q.id FROM resale_requests q WHERE q.asker_id = ? UNION SELECT q.id FROM resale_requests q JOIN resale_listings l ON l.id = q.listing_id WHERE l.seller_id = ?)";
export function resaleDeleteStatements(db, shopperId) {
  return [
    db.prepare("DELETE FROM resale_messages WHERE request_id IN " + MY_REQUESTS).bind(shopperId, shopperId),
    db.prepare("DELETE FROM resale_reports WHERE reporter_id = ? OR request_id IN " + MY_REQUESTS).bind(shopperId, shopperId, shopperId),
    db.prepare("DELETE FROM resale_requests WHERE asker_id = ? OR listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?) OR offered_listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?)").bind(shopperId, shopperId, shopperId),
    db.prepare("DELETE FROM resale_listings WHERE seller_id = ?").bind(shopperId)
  ];
}

function json(body, status = 200, cors = {}) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}
const clean = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const uuid = () => crypto.randomUUID();

// Whether the shopper could still return the item to the store, so the app can say so.
function returnWindow(details, now) {
  const deadline = (details.returnPlan && details.returnPlan.deadline) || (details.returns && details.returns.deadline) || null;
  if (!deadline) return { known: false, open: null, deadline: null };
  return { known: true, open: deadline >= new Date(now).toISOString().slice(0, 10), deadline };
}

// The shopper's own receipt items that could be listed, with whether each is already listed.
async function listable(env, shopperId, now) {
  const rows = await env.RELAY_DB.prepare(
    "SELECT id, details FROM captured_receipts WHERE shopper_id = ? AND status NOT IN ('dismissed','not_receipt') ORDER BY created_at DESC LIMIT 100")
    .bind(shopperId).all();
  const plans = new Map();
  const out = [];
  const parsed = (rows.results || []).map(r => ({ id: r.id, ...JSON.parse(r.details) }));
  for (const p of parsed) if (p.kind === "return_instructions" && p.orderRef) plans.set(p.orderRef, p);
  const active = await env.RELAY_DB.prepare("SELECT receipt_id, item_index FROM resale_listings WHERE seller_id = ? AND status = 'active'").bind(shopperId).all();
  const taken = new Set((active.results || []).map(a => a.receipt_id + ":" + a.item_index));
  for (const r of parsed) {
    if (r.kind === "return_instructions" || !Array.isArray(r.items)) continue;
    if (r.orderRef && plans.has(r.orderRef)) r.returnPlan = plans.get(r.orderRef);
    const rw = returnWindow(r, now);
    r.items.forEach((it, i) => {
      if (!it || typeof it.name !== "string") return;
      out.push({ receiptId: r.id, itemIndex: i, title: it.name, store: (r.retailer && (r.retailer.name || r.retailer.domain)) || null,
        pricePence: it.pricePence ?? null, currency: r.currency || "GBP", hasImage: Boolean(r.hasImage),
        orderDate: r.orderDate || null, returnWindowOpen: rw.open, returnDeadline: rw.deadline, alreadyListed: taken.has(r.id + ":" + i) });
    });
  }
  return out;
}

async function createListing(env, shopper, body, now) {
  if (!body || body.agree !== true) return { status: 400, body: { error: "agreement_required" } };
  const receiptId = typeof body.receiptId === "string" && /^[0-9a-f-]{36}$/.test(body.receiptId) ? body.receiptId : "";
  const index = Number.isInteger(body.itemIndex) && body.itemIndex >= 0 && body.itemIndex < 100 ? body.itemIndex : -1;
  if (!receiptId || index < 0) return { status: 400, body: { error: "invalid_item" } };
  if (!CONDITIONS.includes(body.condition)) return { status: 400, body: { error: "invalid_condition" } };
  let ask = null;
  if (body.askPence != null) {
    if (!Number.isInteger(body.askPence) || body.askPence < 0 || body.askPence > MAX_ASK_PENCE) return { status: 400, body: { error: "invalid_price" } };
    ask = body.askPence;
  }
  // Ownership: the receipt must belong to the signed-in shopper. Anything else looks like "not found".
  const row = await env.RELAY_DB.prepare(
    "SELECT id, details, status FROM captured_receipts WHERE id = ? AND shopper_id = ?").bind(receiptId, shopper.id).first();
  if (!row || row.status === "dismissed" || row.status === "not_receipt") return { status: 404, body: { error: "not_found" } };
  const d = JSON.parse(row.details);
  const item = Array.isArray(d.items) ? d.items[index] : null;
  if (!item || typeof item.name !== "string") return { status: 404, body: { error: "not_found" } };
  const count = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM resale_listings WHERE seller_id = ? AND status = 'active'").bind(shopper.id).first();
  if (count && count.n >= MAX_ACTIVE_LISTINGS) return { status: 429, body: { error: "too_many_listings" } };
  const id = uuid();
  try {
    await env.RELAY_DB.prepare(
      `INSERT INTO resale_listings (id, seller_id, receipt_id, item_index, title, store, currency, size, condition, ask_pence, swap_ok, note, has_image, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`)
      .bind(id, shopper.id, receiptId, index, clean(item.name, 120), clean((d.retailer && (d.retailer.name || d.retailer.domain)) || "", 60) || null,
        d.currency === "GBP" || !d.currency ? "GBP" : clean(d.currency, 3), clean(body.size, 20) || null, body.condition, ask,
        body.swapOk === true ? 1 : 0, clean(body.note, 200) || null, d.hasImage && d.items.length === 1 ? 1 : 0, now).run(); // a receipt photo is only trusted as the item's photo when the order has one item
  } catch (e) {
    return { status: 409, body: { error: "already_listed" } };
  }
  return { status: 200, body: { ok: true, id, returnWindow: returnWindow(d, now) } };
}

const publicListing = (r, mine) => ({
  id: r.id, title: r.title, store: r.store, size: r.size, condition: r.condition, askPence: r.ask_pence, currency: r.currency || "GBP",
  swapOk: Boolean(r.swap_ok), note: r.note, hasImage: Boolean(r.has_image), createdAt: r.created_at, status: r.status, mine: Boolean(mine)
});

async function feed(env, shopper) {
  const rows = await env.RELAY_DB.prepare(
    `SELECT l.* FROM resale_listings l WHERE l.status = 'active' AND l.seller_id != ?
       ORDER BY l.created_at DESC LIMIT 60`).bind(shopper.id).all();
  const mine = await env.RELAY_DB.prepare("SELECT id, listing_id, kind, status FROM resale_requests WHERE asker_id = ?").bind(shopper.id).all();
  const asked = new Map((mine.results || []).map(r => [r.listing_id, r]));
  return (rows.results || []).map(r => ({ ...publicListing(r, false), myRequest: asked.has(r.id) ? { id: asked.get(r.id).id, kind: asked.get(r.id).kind, status: asked.get(r.id).status } : null }));
}

async function myStuff(env, shopper) {
  const listings = await env.RELAY_DB.prepare(
    "SELECT * FROM resale_listings WHERE seller_id = ? AND status IN ('active','matched') ORDER BY created_at DESC LIMIT 60").bind(shopper.id).all();
  const out = [];
  for (const l of listings.results || []) {
    const reqs = await env.RELAY_DB.prepare(
      "SELECT id, kind, offered_listing_id, message, status, created_at, asker_id FROM resale_requests WHERE listing_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 50").bind(l.id).all();
    const requests = [];
    let n = 0;
    for (const q of reqs.results || []) {
      n++;
      let offered = null;
      if (q.offered_listing_id) {
        const o = await env.RELAY_DB.prepare("SELECT title, store, size, condition FROM resale_listings WHERE id = ?").bind(q.offered_listing_id).first();
        if (o) offered = { title: o.title, store: o.store, size: o.size, condition: o.condition };
      }
      requests.push({ id: q.id, who: "Member " + n, kind: q.kind, message: q.message, status: q.status, createdAt: q.created_at, offered });
    }
    out.push({ ...publicListing(l, true), requests });
  }
  const asked = await env.RELAY_DB.prepare(
    `SELECT q.id, q.kind, q.status, q.created_at, l.title, l.store FROM resale_requests q JOIN resale_listings l ON l.id = q.listing_id
       WHERE q.asker_id = ? ORDER BY q.created_at DESC LIMIT 40`).bind(shopper.id).all();
  return { listings: out, myRequests: (asked.results || []).map(r => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, title: r.title, store: r.store })) };
}

async function ask(env, shopper, listingId, body, now) {
  const kind = body && body.kind === "swap" ? "swap" : body && body.kind === "buy" ? "buy" : "";
  if (!kind) return { status: 400, body: { error: "invalid_request" } };
  const l = await env.RELAY_DB.prepare("SELECT id, seller_id, swap_ok FROM resale_listings WHERE id = ? AND status = 'active'").bind(listingId).first();
  if (!l) return { status: 404, body: { error: "not_found" } };
  if (l.seller_id === shopper.id) return { status: 400, body: { error: "own_listing" } };
  let offered = null;
  if (kind === "swap") {
    if (!l.swap_ok) return { status: 400, body: { error: "swap_not_offered" } };
    offered = typeof body.offeredListingId === "string" ? body.offeredListingId : "";
    const mine = await env.RELAY_DB.prepare("SELECT id FROM resale_listings WHERE id = ? AND seller_id = ? AND status = 'active'").bind(offered, shopper.id).first();
    if (!mine) return { status: 400, body: { error: "offer_one_of_your_listings" } };
  }
  const today = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM resale_requests WHERE asker_id = ? AND created_at > ?").bind(shopper.id, now - DAY).first();
  if (today && today.n >= MAX_REQUESTS_PER_DAY) return { status: 429, body: { error: "too_many_requests" } };
  try {
    await env.RELAY_DB.prepare(
      "INSERT INTO resale_requests (id, listing_id, asker_id, kind, offered_listing_id, message, status, created_at) VALUES (?,?,?,?,?,?,'pending',?)")
      .bind(uuid(), listingId, shopper.id, kind, offered, clean(body.message, 200) || null, now).run();
  } catch (e) {
    return { status: 409, body: { error: "already_asked" } };
  }
  return { status: 200, body: { ok: true } };
}

async function decide(env, shopper, requestId, accept) {
  // Only the listing's seller can decide, and only while the request is pending.
  const q = await env.RELAY_DB.prepare(
    `SELECT q.id, q.listing_id FROM resale_requests q JOIN resale_listings l ON l.id = q.listing_id
       WHERE q.id = ? AND l.seller_id = ? AND q.status = 'pending'`).bind(requestId, shopper.id).first();
  if (!q) return { status: 404, body: { error: "not_found" } };
  if (!accept) {
    await env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE id = ?").bind(requestId).run();
    return { status: 200, body: { ok: true } };
  }
  await env.RELAY_DB.batch([
    env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'accepted' WHERE id = ?").bind(requestId),
    env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE listing_id = ? AND id != ? AND status = 'pending'").bind(q.listing_id, requestId),
    env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'matched' WHERE id = ? AND seller_id = ?").bind(q.listing_id, shopper.id)
  ]);
  return { status: 200, body: { ok: true } };
}


// ---- Messages between a seller and the member whose request they accepted ----------------
// Only those two can read or write a thread, only while the request is accepted. Contact details are
// refused so people stay anonymous to each other until payments and handover exist.
const MAX_MESSAGE = 500, MAX_THREAD = 200, MAX_MESSAGES_PER_HOUR = 20;
const CONTACT = [/[A-Za-z0-9._%+-]+\s*(?:@|\(at\)| at )\s*[A-Za-z0-9-]+\s*(?:\.|\(dot\)| dot )\s*[A-Za-z]{2,}/i, /(?:\+?\d[\s().-]*){9,}/, /https?:\/\/|www\./i];

async function party(env, shopper, requestId) {
  const q = await env.RELAY_DB.prepare(
    `SELECT q.id, q.status, q.asker_id, l.seller_id, l.title, l.id AS listing_id FROM resale_requests q JOIN resale_listings l ON l.id = q.listing_id WHERE q.id = ?`).bind(requestId).first();
  if (!q || (q.asker_id !== shopper.id && q.seller_id !== shopper.id)) return null;
  return { ...q, iAmSeller: q.seller_id === shopper.id };
}

async function readThread(env, shopper, requestId) {
  const q = await party(env, shopper, requestId);
  if (!q) return { status: 404, body: { error: "not_found" } };
  const rows = await env.RELAY_DB.prepare("SELECT sender_id, body, created_at FROM resale_messages WHERE request_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 200").bind(requestId).all();
  return { status: 200, body: { title: q.title, status: q.status, with: q.iAmSeller ? "Buyer" : "Seller", open: q.status === "accepted",
    messages: (rows.results || []).map(m => ({ mine: m.sender_id === shopper.id, body: m.body, createdAt: m.created_at })) } };
}

async function sendMessage(env, shopper, requestId, body, now) {
  const q = await party(env, shopper, requestId);
  if (!q) return { status: 404, body: { error: "not_found" } };
  if (q.status !== "accepted") return { status: 409, body: { error: "conversation_closed" } };
  const text = clean(body && body.body, MAX_MESSAGE);
  if (!text) return { status: 400, body: { error: "empty_message" } };
  if (CONTACT.some(re => re.test(text))) return { status: 400, body: { error: "no_contact_details" } };
  const n = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM resale_messages WHERE request_id = ?").bind(requestId).first();
  if (n && n.n >= MAX_THREAD) return { status: 429, body: { error: "thread_full" } };
  const recent = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM resale_messages WHERE sender_id = ? AND created_at > ?").bind(shopper.id, now - 60 * 60 * 1000).first();
  if (recent && recent.n >= MAX_MESSAGES_PER_HOUR) return { status: 429, body: { error: "too_many_messages" } };
  await env.RELAY_DB.prepare("INSERT INTO resale_messages (id, request_id, sender_id, body, created_at) VALUES (?,?,?,?,?)").bind(uuid(), requestId, shopper.id, text, now).run();
  return { status: 200, body: { ok: true } };
}

// Either side can end a conversation. The listing goes back on sale, and a report is kept for review.
async function endConversation(env, shopper, requestId, reason, now) {
  const q = await party(env, shopper, requestId);
  if (!q) return { status: 404, body: { error: "not_found" } };
  if (q.status !== "accepted") return { status: 409, body: { error: "conversation_closed" } };
  const stmts = [
    env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'closed' WHERE id = ?").bind(requestId),
    env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'active' WHERE id = ? AND status = 'matched'").bind(q.listing_id)
  ];
  if (reason !== null) stmts.push(env.RELAY_DB.prepare("INSERT INTO resale_reports (id, request_id, reporter_id, reason, created_at) VALUES (?,?,?,?,?)").bind(uuid(), requestId, shopper.id, reason, now));
  await env.RELAY_DB.batch(stmts);
  return { status: 200, body: { ok: true } };
}

export async function handleResaleRoute(request, env, url, cors, shopper, opts) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/resale/") && !path.startsWith("/relay/my/admin/")) return null;
  await ensureResaleTables(env.RELAY_DB);
  const m = request.method;
  const adminResponse = await handleResaleAdminRoute(path, m, request, env, cors, shopper, opts.now);
  if (adminResponse) return adminResponse;
  // A blocked member can still read and withdraw, but cannot list, ask or message.
  if (m === "POST" && /\/resale\/(listings|listings\/[0-9a-f-]{36}\/ask|requests\/[0-9a-f-]{36}\/messages)$/.test(path) && await isBlocked(env, shopper))
    return json({ error: "account_restricted" }, 403, cors);
  const body = async () => { const t = await request.text(); if (t.length > 5000) return null; try { return JSON.parse(t || "{}"); } catch (e) { return null; } };
  const send = r => json(r.body, r.status, cors);
  if (path === "/relay/my/resale/items" && m === "GET") return json({ items: await listable(env, shopper.id, opts.now) }, 200, cors);
  if (path === "/relay/my/resale/feed" && m === "GET") return json({ listings: await feed(env, shopper) }, 200, cors);
  if (path === "/relay/my/resale/mine" && m === "GET") return json(await myStuff(env, shopper), 200, cors);
  if (path === "/relay/my/resale/listings" && m === "POST") {
    const b = await body(); if (!b) return json({ error: "invalid_request" }, 400, cors);
    return send(await createListing(env, shopper, b, opts.now));
  }
  const withdraw = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/withdraw$/.exec(path);
  if (withdraw && m === "POST") {
    const r = await env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'withdrawn' WHERE id = ? AND seller_id = ? AND status IN ('active','matched') RETURNING id").bind(withdraw[1], shopper.id).first();
    if (r) {
      await env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE listing_id = ? AND status = 'pending'").bind(withdraw[1]).run();
      await env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'closed' WHERE listing_id = ? AND status = 'accepted'").bind(withdraw[1]).run();
    }
    return r ? json({ ok: true }, 200, cors) : json({ error: "not_found" }, 404, cors);
  }
  const interest = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/ask$/.exec(path);
  if (interest && m === "POST") {
    const b = await body(); if (!b) return json({ error: "invalid_request" }, 400, cors);
    return send(await ask(env, shopper, interest[1], b, opts.now));
  }
  const thread = /^\/relay\/my\/resale\/requests\/([0-9a-f-]{36})\/(messages|end|report)$/.exec(path);
  if (thread) {
    if (thread[2] === "messages" && m === "GET") return send(await readThread(env, shopper, thread[1]));
    if (m === "POST") {
      const b = await body(); if (!b) return json({ error: "invalid_request" }, 400, cors);
      if (thread[2] === "messages") return send(await sendMessage(env, shopper, thread[1], b, opts.now));
      return send(await endConversation(env, shopper, thread[1], thread[2] === "report" ? clean(b.reason, 200) : null, opts.now));
    }
  }
  const decision = /^\/relay\/my\/resale\/requests\/([0-9a-f-]{36})\/(accept|decline)$/.exec(path);
  if (decision && m === "POST") return send(await decide(env, shopper, decision[1], decision[2] === "accept"));
  const image = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/image$/.exec(path);
  if (image && m === "GET") {
    // Any signed-in member may see the photo of an active listing, and sellers see their own.
    const row = await env.RELAY_DB.prepare(
      `SELECT i.type, i.data FROM resale_listings l JOIN receipt_images i ON i.receipt_id = l.receipt_id
         WHERE l.id = ? AND l.has_image = 1 AND (l.status = 'active' OR l.seller_id = ?)`).bind(image[1], shopper.id).first();
    if (!row) return json({ error: "not_found" }, 404, cors);
    return new Response(Uint8Array.from(atob(row.data), c => c.charCodeAt(0)), {
      status: 200, headers: { ...cors, "Content-Type": row.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  }
  return json({ error: "not_found" }, 404, cors);
}
