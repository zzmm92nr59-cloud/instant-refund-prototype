// AI for picks: Claude (Anthropic's AI) reads the names of the things a shopper bought, so Browse's "Picked for you" knows
// what each one is, instead of Relay's word lists (relay-recommendation-engine.js) guessing from the name.
//
// Rules (do not weaken):
//  * Off unless the shopper switched it on (picks_ai), and off for everyone until ANTHROPIC_API_KEY is set.
//  * Only item names and the shop's name go to Anthropic, with anything that looks personal hidden first (hideDetails):
//    never the email, the address, the order number or the price. Anthropic's terms don't let it train on what Relay sends.
//  * Each name is read once and kept with the shopper (item_kinds). At most 40 names a request and 120 a day per shopper.
//  * What the AI says only shapes picks. It never changes a receipt.
//  * Switching it off deletes what the AI said. It also goes with the inbox, the permission and the account (gmail.js).
//
// GET /relay/my/item-kinds: { available, on, kinds: { "<item name, lower case>": { mode, kind, noun, look } } }. With it on,
//   names not read yet are read first (up to 40). POST { on }: switches it.
import { aiAvailable, PICKS_AI_SQL, ITEM_KINDS_SQL } from "./ai-reader.js";
import { aiModel } from "./ai-runner.js";
import { hideDetails, namesToHide } from "./shared-emails.js";
import { styleThings } from "./gmail.js";

export const KINDS_PER_ASK = 40;
export const KINDS_PER_DAY = 120;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
export const nameKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);

export const KINDS_SYSTEM = [
  "You help Relay, a UK shopping app, suggest products from the things a person bought. You get a JSON list of items, each with an id, the item's name as written on a receipt, and the shop.",
  "Reply with one JSON object and nothing else: {\"items\":[{\"id\":...,\"mode\":...,\"kind\":...,\"look\":[...]}]}, one entry per item.",
  "mode is one of: \"again\" (clothes, shoes, accessories, beauty, candles and other things people buy more of in other styles or colours),",
  "\"with\" (something that has a natural companion to suggest, such as coffee or capsules (cups), tea (mugs), wine (glasses), a duvet (covers)),",
  "\"once\" (a one-off: electronics, appliances, furniture, a TV, gift cards, services, subscriptions, delivery charges),",
  "\"skip\" (groceries and anything else not worth suggesting from, or when you can't tell what it is).",
  "kind: what the item is, as a short plural noun a shopper would say, such as \"leggings\", \"trainers\", \"hoodies\", \"coffee\". Lower case.",
  "look: for again, 1 to 4 words or short phrases a shop would use in the names of similar products (\"leggings\", \"tights\"); for with, 1 to 4 for the companion (\"espresso cup\", \"coffee cup\"); otherwise an empty list. Lower case.",
  "Brand product names count: \"Align High-Rise Pant 25\" from lululemon is leggings. Text such as [name] or [number] hides personal details: ignore it, never guess. Never invent items."
].join(" ");

const WORD = /^[a-z][a-z' -]{0,29}$/;
// What's accepted back: only the four modes, a short kind, and plain lower-case words. Anything else is dropped.
export function cleanKinds(text, ids) {
  let o; try { o = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!o || !Array.isArray(o.items)) return null;
  const out = new Map();
  for (const x of o.items) {
    if (!x || !ids.has(String(x.id))) continue;
    const mode = ["again", "with", "once", "skip"].includes(x.mode) ? x.mode : "skip";
    const kind = typeof x.kind === "string" && WORD.test(x.kind.toLowerCase().trim()) ? x.kind.toLowerCase().trim() : null;
    const look = (Array.isArray(x.look) ? x.look : []).map((w) => String(w || "").toLowerCase().trim()).filter((w) => WORD.test(w)).slice(0, 4);
    out.set(String(x.id), (mode === "again" || mode === "with") && kind && look.length ? { mode, kind, look } : { mode: mode === "once" ? "once" : "skip" });
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
      body: JSON.stringify({ model: aiModel(env), max_tokens: 3000, system: KINDS_SYSTEM, messages: [{ role: "user", content }] }) });
  } catch { return null; }
  if (!r.ok) return null;
  const body = await r.json().catch(() => null);
  const text = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  return cleanKinds(text, ids);
}

export async function handleItemKindsRoute(path, method, request, env, cors, shopper, o) {
  if (path !== "/relay/my/item-kinds") return null;
  const db = env.RELAY_DB, now = (o && o.now) || Date.now(), fetchImpl = (o && o.fetchImpl) || fetch;
  await db.batch([db.prepare(PICKS_AI_SQL), db.prepare(ITEM_KINDS_SQL)]);
  const isOn = async () => aiAvailable(env) && Boolean(await db.prepare("SELECT 1 AS x FROM picks_ai WHERE shopper_id = ?").bind(shopper.id).first());
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
  const on = await isOn();
  if (!on) return json({ available: aiAvailable(env), on: false, kinds: {} }, 200, cors);
  const known = new Map((await db.prepare("SELECT name_key, data, created_at FROM item_kinds WHERE shopper_id = ?").bind(shopper.id).all()).results
    .map((r) => [r.name_key, r]));
  // Names not read yet, newest receipts first (styleThings keeps receipt order), within today's allowance.
  const today = [...known.values()].filter((r) => r.created_at > now - DAY).length;
  const room = Math.min(KINDS_PER_ASK, Math.max(0, KINDS_PER_DAY - today));
  const fresh = new Map();
  // Their own names too (from their profile and the part before the @ of their address), as for AI help.
  let names = [];
  if (room > 0) {
    const prof = await db.prepare("SELECT name FROM shopper_profiles WHERE shopper_id = ?").bind(shopper.id).first().catch(() => null);
    names = namesToHide(prof && prof.name, [shopper.email]);
  }
  const hide = (t) => hideDetails(t, names).text;
  if (room > 0) for (const t of await styleThings(env, shopper.id)) for (const i of t.items) {
    const k = nameKey(i.name); if (!k || known.has(k) || fresh.has(k) || fresh.size >= room) continue;
    const shop = (t.retailer && t.retailer.name) || "";
    fresh.set(k, { id: String(fresh.size + 1), key: k, name: hide(i.name).slice(0, 120), shop: hide(shop).slice(0, 60) });
  }
  if (fresh.size) {
    const got = await askKinds(env, [...fresh.values()], fetchImpl);
    if (got) {
      const rows = [...fresh.values()].map((x) => [x.key, JSON.stringify(got.get(x.id) || { mode: "skip" })]);
      await db.batch(rows.map(([k, d]) => db.prepare("INSERT OR REPLACE INTO item_kinds (shopper_id, name_key, data, created_at) VALUES (?, ?, ?, ?)").bind(shopper.id, k, d, now)));
      rows.forEach(([k, d]) => known.set(k, { name_key: k, data: d, created_at: now }));
    }
  }
  const kinds = {};
  for (const [k, r] of known) { try { const d = JSON.parse(r.data); if (d && (d.mode === "again" || d.mode === "with" || d.mode === "once")) kinds[k] = d; } catch {} }
  return json({ available: true, on: true, kinds }, 200, cors);
}
