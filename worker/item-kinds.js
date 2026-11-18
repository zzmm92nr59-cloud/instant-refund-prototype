// AI for picks and for what things are: Claude (Anthropic's AI) reads the names of the things a shopper bought, so Relay
// knows what each one is (item-kind-core.js's fixed list: food and drink, clothing, footwear, electronics…) and what Browse's
// "Picked for you" should follow, instead of only Relay's own rules guessing from the name. One question answers both: there
// is no second AI system for kinds.
//
// Rules (do not weaken):
//  * Off unless the shopper switched it on (picks_ai, "AI for picks" under AI help), and off for everyone until
//    ANTHROPIC_API_KEY is set. Without it, Relay's own rules decide, and a line they aren't sure of is "other": never a guess.
//  * Only item names and the shop's name go to Anthropic, with anything that looks personal hidden first (hideDetails):
//    never the email, the address, the order number or the price. Anthropic's terms don't let it train on what Relay sends.
//  * Each name is read once and kept with the shopper (item_kinds). At most 40 names a request and 120 a day per shopper.
//  * An item name that had nothing personal in it (hiding changed nothing) is also kept on its own, with no shopper, in
//    item_kind_cache, so the next shopper with AI on who bought the same thing ("Haribo Starmix 140g") isn't asked about it
//    again. That copy holds only the name and what the AI said: not who bought it, when, where or for how much. A name with
//    anything hidden in it is never kept there.
//  * What the AI says shapes picks and what each thing on a receipt is counted as (Wrapped, the receipts list's groups),
//    only when it says it is sure; it never changes what the receipt says (shop, items, prices, dates).
//  * Switching it off deletes what the AI said for that shopper (item_kinds), and Relay stops using any AI answers for them.
//    It also goes with the inbox, the permission and the account (gmail.js).
//
// GET /relay/my/item-kinds: { available, on, kinds: { "<item name, lower case>": { mode, kind, look } } }. With it on,
//   names not read yet are read first (up to 40). POST { on }: switches it.
import { aiAvailable, PICKS_AI_SQL, ITEM_KINDS_SQL, ITEM_KIND_CACHE_SQL } from "./ai-reader.js";
import { aiModel } from "./ai-runner.js";
import { hideDetails, namesToHide } from "./shared-emails.js";
import { boughtNames } from "./gmail.js";
import KindCore from "./item-kind-core.js";

export const KINDS_PER_ASK = 40;
export const KINDS_PER_DAY = 120;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
export const nameKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
const TYPES = KindCore.KINDS;

export const KINDS_SYSTEM = [
  "You help Relay, a UK shopping app, understand the things a person bought. You get a JSON list of items, each with an id, the item's name as written on a receipt, and the shop.",
  "Reply with one JSON object and nothing else: {\"items\":[{\"id\":...,\"type\":...,\"sure\":...,\"mode\":...,\"kind\":...,\"look\":[...]}]}, one entry per item.",
  "type: what the item is, exactly one of: " + TYPES.map((k) => "\"" + k + "\" (" + KindCore.KIND_LIST[k].label + ")").join(", ") + ".",
  "Sweets, snacks, groceries, drinks and alcohol are food_drink; cleaning things, laundry, toilet roll, kitchen roll, bin bags, batteries, light bulbs and toiletries (shower gel, toothpaste, deodorant, shampoo, nappies) are household; skincare, make-up, perfume, medicines and vitamins are beauty_health; hair dryers, straighteners and electric toothbrushes are electronics; bags, hats, jewellery and watches are accessories; furniture, bedding, kitchenware, candles and plants are home; pet food and pet things are pets; train, coach and plane tickets, hotels, taxis and parking are travel; apps, subscriptions, in-app purchases and digital games are digital; delivery charges, fees, repairs, warranties and event tickets are services.",
  "Words for how something is packed never make it that thing: a \"sharing bag\" of sweets is food_drink, a \"gift bag\" is household, a \"case of 12\" bottles is food_drink.",
  "sure: true only when you know what the item is; false when you are guessing or can't tell. Use type \"other\" with sure false when you can't tell.",
  "mode is one of: \"again\" (clothes, shoes, accessories, beauty, candles and other things people buy more of in other styles or colours),",
  "\"with\" (something that has a natural companion to suggest, such as coffee or capsules (cups), tea (mugs), wine (glasses), a duvet (covers)),",
  "\"once\" (a one-off: electronics, appliances, furniture, a TV, gift cards, services, subscriptions, delivery charges),",
  "\"skip\" (groceries and anything else not worth suggesting from, or when you can't tell what it is).",
  "kind: what the item is, as a short plural noun a shopper would say, such as \"leggings\", \"trainers\", \"hoodies\", \"coffee\". Lower case.",
  "look: for again, 1 to 4 words or short phrases a shop would use in the names of similar products (\"leggings\", \"tights\"); for with, 1 to 4 for the companion (\"espresso cup\", \"coffee cup\"); otherwise an empty list. Lower case.",
  "Brand product names count: \"Align High-Rise Pant 25\" from lululemon is leggings (clothing). Text such as [name] or [number] hides personal details: ignore it, never guess. Never invent items."
].join(" ");

const WORD = /^[a-z][a-z' -]{0,29}$/;
// What's accepted back: only the four modes, a short kind, plain lower-case words, and a type from the fixed list with
// whether the AI is sure. Anything else is dropped.
export function cleanKinds(text, ids) {
  let o; try { o = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!o || !Array.isArray(o.items)) return null;
  const out = new Map();
  for (const x of o.items) {
    if (!x || !ids.has(String(x.id))) continue;
    const mode = ["again", "with", "once", "skip"].includes(x.mode) ? x.mode : "skip";
    const kind = typeof x.kind === "string" && WORD.test(x.kind.toLowerCase().trim()) ? x.kind.toLowerCase().trim() : null;
    const look = (Array.isArray(x.look) ? x.look : []).map((w) => String(w || "").toLowerCase().trim()).filter((w) => WORD.test(w)).slice(0, 4);
    const picks = (mode === "again" || mode === "with") && kind && look.length ? { mode, kind, look } : { mode: mode === "once" ? "once" : "skip" };
    const type = typeof x.type === "string" && TYPES.includes(x.type) ? x.type : null;
    out.set(String(x.id), type ? { ...picks, type, sure: x.sure === true && type !== "other" } : picks);
  }
  return out;
}

async function askKinds(env, list, fetchImpl) {
  const ids = new Set(list.map((x) => x.id));
  const content = JSON.stringify(list.map((x) => ({ id: x.id, name: x.name, shop: x.shop })));
  let r;
  try {
    r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(25000),
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: aiModel(env), max_tokens: 4000, system: KINDS_SYSTEM, messages: [{ role: "user", content }] }) });
  } catch { return null; }
  if (!r.ok) return null;
  const body = await r.json().catch(() => null);
  const text = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  return cleanKinds(text, ids);
}

const isOnFor = async (env, db, shopperId) => aiAvailable(env) && Boolean(await db.prepare("SELECT 1 AS x FROM picks_ai WHERE shopper_id = ?").bind(shopperId).first());

// For a shopper with AI on: the names of things they bought that haven't been read yet, newest first, within today's
// allowance, are read (a name another shopper's AI already read, with nothing personal in it, is taken from the shared copy
// without asking). Returns Map(name key → row) of everything the AI said for them, or null when AI is off for them.
export async function learnItemKinds(env, shopper, o) {
  const db = env.RELAY_DB, now = (o && o.now) || Date.now(), fetchImpl = (o && o.fetchImpl) || fetch;
  await db.batch([db.prepare(PICKS_AI_SQL), db.prepare(ITEM_KINDS_SQL), db.prepare(ITEM_KIND_CACHE_SQL)]);
  if (!(await isOnFor(env, db, shopper.id))) return null;
  const known = new Map((await db.prepare("SELECT name_key, data, created_at FROM item_kinds WHERE shopper_id = ?").bind(shopper.id).all()).results
    .map((r) => [r.name_key, r]));
  // Asked from a screen being opened: answer with what's known now; asking Claude happens after the response (o.later).
  // Connor, 18 Nov 2026: Wrapped stopped loading and the app slowed while every open waited for the AI.
  if (o && o.askNow === false) return known;
  const today = [...known.values()].filter((r) => r.created_at > now - DAY).length;
  const room = Math.min(KINDS_PER_ASK, Math.max(0, KINDS_PER_DAY - today));
  if (room <= 0) return known;
  // Their own names too (from their profile and the part before the @ of their address), as for AI help.
  const prof = await db.prepare("SELECT name FROM shopper_profiles WHERE shopper_id = ?").bind(shopper.id).first().catch(() => null);
  const names = namesToHide(prof && prof.name, [shopper.email]);
  const fresh = new Map();
  for (const b of await boughtNames(env, shopper.id)) {
    const k = nameKey(b.name); if (!k || known.has(k) || fresh.has(k) || fresh.size >= room) continue;
    const hidden = hideDetails(b.name, names).text.slice(0, 120);
    fresh.set(k, { id: String(fresh.size + 1), key: k, name: hidden, shop: hideDetails(b.shop || "", names).text.slice(0, 60), shareable: hidden === String(b.name).slice(0, 120) });
  }
  if (!fresh.size) return known;
  // Names already read for someone else, with nothing personal in them: no need to ask.
  const shared = [...fresh.values()].filter((x) => x.shareable).map((x) => x.key);
  const cached = new Map();
  for (let i = 0; i < shared.length; i += 40) {
    const chunk = shared.slice(i, i + 40);
    const rows = (await db.prepare(`SELECT name_key, data FROM item_kind_cache WHERE name_key IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all()).results || [];
    rows.forEach((r) => cached.set(r.name_key, r.data));
  }
  const ask = [...fresh.values()].filter((x) => !cached.has(x.key));
  const got = ask.length ? await askKinds(env, ask, fetchImpl) : new Map();
  const rows = [];
  for (const x of fresh.values()) {
    if (cached.has(x.key)) rows.push([x.key, cached.get(x.key), false]);
    else if (got) rows.push([x.key, JSON.stringify(got.get(x.id) || { mode: "skip" }), x.shareable && got.has(x.id)]);
  }
  if (rows.length) {
    const st = rows.map(([k, d]) => db.prepare("INSERT OR REPLACE INTO item_kinds (shopper_id, name_key, data, created_at) VALUES (?, ?, ?, ?)").bind(shopper.id, k, d, now));
    for (const [k, d, share] of rows) if (share) st.push(db.prepare("INSERT OR IGNORE INTO item_kind_cache (name_key, data, created_at) VALUES (?, ?, ?)").bind(k, d, now));
    await db.batch(st);
    rows.forEach(([k, d]) => known.set(k, { name_key: k, data: d, created_at: now }));
  }
  return known;
}

// What the AI said each of a shopper's things is, for item-kind-core.js ({ "<name key>": { type, sure } }), only for a
// shopper with AI on; {} otherwise. Read with their receipts (gmail.js listReceipts).
export async function aiTypesFor(env, shopperId) {
  const db = env.RELAY_DB;
  try {
    if (!(await isOnFor(env, db, shopperId))) return {};
    const rows = (await db.prepare("SELECT name_key, data FROM item_kinds WHERE shopper_id = ?").bind(shopperId).all()).results || [];
    const out = {};
    for (const r of rows) { try { const d = JSON.parse(r.data); if (d && d.type && TYPES.includes(d.type)) out[r.name_key] = { type: d.type, sure: d.sure === true }; } catch {} }
    return out;
  } catch { return {}; }
}

export async function handleItemKindsRoute(path, method, request, env, cors, shopper, o) {
  if (path !== "/relay/my/item-kinds") return null;
  const db = env.RELAY_DB, now = (o && o.now) || Date.now();
  await db.batch([db.prepare(PICKS_AI_SQL), db.prepare(ITEM_KINDS_SQL)]);
  if (method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.on !== "boolean") return json({ error: "invalid_request" }, 400, cors);
    if (b.on) {
      if (!aiAvailable(env)) return json({ error: "ai_off" }, 503, cors);
      await db.prepare("INSERT OR IGNORE INTO picks_ai (shopper_id, on_since) VALUES (?, ?)").bind(shopper.id, now).run();
    } else {
      await db.batch([db.prepare("DELETE FROM picks_ai WHERE shopper_id = ?").bind(shopper.id), db.prepare("DELETE FROM item_kinds WHERE shopper_id = ?").bind(shopper.id)]);
    }
    return json({ available: aiAvailable(env), on: b.on }, 200, cors);
  }
  if (method !== "GET") return json({ error: "not_found" }, 404, cors);
  const known = await learnItemKinds(env, shopper, { ...o, askNow: false });
  if (known && o && o.later) o.later(learnItemKinds(env, shopper, o).catch(() => null));
  if (!known) return json({ available: aiAvailable(env), on: false, kinds: {} }, 200, cors);
  // What picks use: the mode, the kind and the words to look for (what each thing is goes with the receipts instead).
  const kinds = {};
  for (const [k, r] of known) {
    try { const d = JSON.parse(r.data); if (d && (d.mode === "again" || d.mode === "with" || d.mode === "once")) kinds[k] = d.mode === "once" ? { mode: "once" } : { mode: d.mode, kind: d.kind, look: d.look }; } catch {}
  }
  return json({ available: true, on: true, kinds }, 200, cors);
}
