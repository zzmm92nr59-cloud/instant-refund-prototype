// What Relay spends on Anthropic's AI, and the limits that stop it spending more. Every call to Anthropic goes through
// claudeFetch below: it checks the limits first, and records what the call cost from the answer's own token counts.
//
// Rules (do not weaken):
//  * One monthly limit for every AI feature together: AI_MONTHLY_LIMIT_PENCE (default 2000, £20), counted per calendar
//    month (UTC). And a daily limit per shopper for reading their receipts (the AI reader, "Read it again" and receipt
//    photos): AI_SHOPPER_DAY_LIMIT_PENCE (default 10p), per calendar day (UTC).
//  * The limit is checked BEFORE each call, as if the call used all of its max_tokens, so a limit can't be overshot by
//    more than what calls already in flight at the same moment cost (a fraction of a penny each).
//  * Once a limit is reached, every feature does what it does without the key (the rules only; "the assistant is off
//    right now"), quietly, until the next month or day. Nothing is queued to be sent later.
//  * What's kept: per month and feature, the number of calls, tokens in and out and the estimated cost (ai_spend: no
//    shopper, no email, nothing read); and per shopper per day only the cost and number of calls of their receipt
//    reading (ai_spend_shopper), for their daily limit, deleted after two days or with the account.
//  * Costs are estimates: Anthropic's list prices in US dollars, turned into pence at AI_USD_TO_GBP (0.80 unless set,
//    on the high side, so the estimate is more likely over than under). Anthropic's own bill is the real figure.

// The model Relay uses unless a setting says otherwise: Claude Haiku 5.5, Anthropic's small fast model, current (released
// 7 Oct 2026, not retired before Oct 2027) and meant for extraction and classification. Source:
// https://platform.claude.com/docs/en/models/haiku-5-5/overview (checked 21 Nov 2026).
export const DEFAULT_MODEL = "claude-haiku-5-5";

// US dollars per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (checked 21 Nov 2026).
// Haiku 5.5 costs more for a prompt over 100,000 tokens (longOver); Relay's prompts are a few thousand. Matched by the
// start of the model's name, so a dated version ("claude-haiku-4-5-20251001") finds its family. Override with the
// AI_PRICES setting, as JSON: {"claude-haiku-5-5": {"in": 0.10, "out": 0.50}}.
export const PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, longOver: 100000, longIn: 0.50, longOut: 2.50 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-haiku-4-5": { in: 1, out: 5 }
};
// A model not in the table is costed at the dearest price on Anthropic's list, so a mistyped name can only make the
// estimate too high, never too low.
const UNKNOWN = { in: 15, out: 75 };
export const DEFAULT_MONTHLY_LIMIT_PENCE = 2000;
export const DEFAULT_SHOPPER_DAY_LIMIT_PENCE = 10;
const DEFAULT_USD_TO_GBP = 0.80;
// The features, as the health page names them. Receipt reading for one shopper counts against their daily limit.
export const FEATURES = ["reader", "reread", "receipt_photo", "item_kinds", "shop_kinds", "photo_search", "help_chat"];
export const SHOPPER_FEATURES = new Set(["reader", "reread", "receipt_photo"]);
// What a picture costs as input, at most (Anthropic: about width × height / 750 tokens, pictures are scaled to ~1.15
// megapixels), with room to spare.
const IMAGE_TOKENS = 2000;

export const AI_SPEND_SQL = `CREATE TABLE IF NOT EXISTS ai_spend (month TEXT NOT NULL, feature TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, pence REAL NOT NULL DEFAULT 0, PRIMARY KEY (month, feature))`;
export const AI_SPEND_SHOPPER_SQL = `CREATE TABLE IF NOT EXISTS ai_spend_shopper (shopper_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  pence REAL NOT NULL DEFAULT 0, PRIMARY KEY (shopper_id, day))`;

const ready = new WeakSet();
export async function ensureSpendTables(db) {
  if (!db || ready.has(db)) return;
  await db.batch([db.prepare(AI_SPEND_SQL), db.prepare(AI_SPEND_SHOPPER_SQL)]);
  ready.add(db);
}
export function spendDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM ai_spend_shopper WHERE shopper_id = ?").bind(shopperId)];
}

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(n) && n >= 0 ? n : d; };
export const monthlyLimit = (env) => num(env && env.AI_MONTHLY_LIMIT_PENCE, DEFAULT_MONTHLY_LIMIT_PENCE);
export const shopperDayLimit = (env) => num(env && env.AI_SHOPPER_DAY_LIMIT_PENCE, DEFAULT_SHOPPER_DAY_LIMIT_PENCE);
const usdToGbp = (env) => num(env && env.AI_USD_TO_GBP, DEFAULT_USD_TO_GBP) || DEFAULT_USD_TO_GBP;
export const monthOf = (now) => new Date(now).toISOString().slice(0, 7);
export const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

export function priceOf(env, model) {
  let table = PRICES;
  if (env && env.AI_PRICES) { try { const o = JSON.parse(env.AI_PRICES); if (o && typeof o === "object") table = { ...PRICES, ...o }; } catch { /* the code's table */ } }
  const m = String(model || "");
  const key = Object.keys(table).filter((k) => m === k || m.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];
  const p = key && table[key];
  return p && Number.isFinite(Number(p.in)) && Number.isFinite(Number(p.out)) ? p : UNKNOWN;
}
// Pence for a call that read `input` tokens (cache writes and reads counted at Anthropic's 1.25× and 0.1×) and wrote
// `output` (thinking included: Anthropic bills it as output).
export function costPence(env, model, usage) {
  const u = usage || {};
  const fresh = Number(u.input_tokens) || 0, write = Number(u.cache_creation_input_tokens) || 0, readC = Number(u.cache_read_input_tokens) || 0;
  const out = Number(u.output_tokens) || 0, p = priceOf(env, model);
  const long = p.longOver && fresh + write + readC > p.longOver;
  const pin = Number(long ? p.longIn : p.in), pout = Number(long ? p.longOut : p.out);
  const usd = ((fresh + write * 1.25 + readC * 0.1) * pin + out * pout) / 1e6;
  return usd * usdToGbp(env) * 100;
}
// What a request could cost at most: its input guessed from its length (a token is about 3 characters, rounded up), and
// all of its max_tokens written.
export function mostItCouldCost(env, body) {
  let chars = String(body.system || "").length, images = 0;
  for (const m of body.messages || []) {
    if (typeof m.content === "string") chars += m.content.length;
    else for (const c of m.content || []) { if (c && c.type === "image") images++; else if (c && typeof c.text === "string") chars += c.text.length; }
  }
  const input = Math.ceil(chars / 3) + images * IMAGE_TOKENS + 50;
  return costPence(env, body.model, { input_tokens: input, output_tokens: Number(body.max_tokens) || 4096 });
}

// What's been spent: this month in all, and today by this shopper.
export async function spentThisMonth(db, now) {
  await ensureSpendTables(db);
  const r = await db.prepare("SELECT COALESCE(SUM(pence), 0) AS p FROM ai_spend WHERE month = ?").bind(monthOf(now)).first();
  return Number((r && r.p) || 0);
}
export async function spentToday(db, shopperId, now) {
  await ensureSpendTables(db);
  const r = await db.prepare("SELECT pence FROM ai_spend_shopper WHERE shopper_id = ? AND day = ?").bind(shopperId, dayOf(now)).first();
  return Number((r && r.pence) || 0);
}
// Whether a call costing up to `reserve` pence may be made now: null if it may, or why not ("month" or "shopper_day").
export async function overLimit(env, { feature, shopperId, reserve = 0, now = Date.now() } = {}) {
  const db = env.RELAY_DB;
  if (!db) return null;
  if ((await spentThisMonth(db, now)) + reserve > monthlyLimit(env)) return "month";
  if (shopperId && SHOPPER_FEATURES.has(feature) && (await spentToday(db, shopperId, now)) + reserve > shopperDayLimit(env)) return "shopper_day";
  return null;
}

export async function recordSpend(env, { feature, shopperId, model, usage, now = Date.now() }) {
  const db = env.RELAY_DB;
  if (!db) return 0;
  await ensureSpendTables(db);
  const pence = costPence(env, model, usage), u = usage || {};
  const input = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
  const st = [db.prepare(`INSERT INTO ai_spend (month, feature, calls, input_tokens, output_tokens, pence) VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT (month, feature) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens, pence = pence + excluded.pence`)
    .bind(monthOf(now), FEATURES.includes(feature) ? feature : "other", input, Number(u.output_tokens) || 0, pence)];
  if (shopperId && SHOPPER_FEATURES.has(feature)) {
    st.push(db.prepare(`INSERT INTO ai_spend_shopper (shopper_id, day, calls, pence) VALUES (?, ?, 1, ?)
      ON CONFLICT (shopper_id, day) DO UPDATE SET calls = calls + 1, pence = pence + excluded.pence`).bind(shopperId, dayOf(now), pence));
    st.push(db.prepare("DELETE FROM ai_spend_shopper WHERE day < ?").bind(dayOf(now - 864e5)));
  }
  await db.batch(st);
  return pence;
}

// Thinking off for the jobs that only copy what an email or a picture says: Haiku 5.5 thinks by default, which is paid
// for as output and can use up max_tokens before any answer is written (Anthropic: "thinking tokens count toward
// max_tokens"). AI_THINKING=on leaves it to the model.
export const noThinking = (env) => (String((env && env.AI_THINKING) || "").toLowerCase() === "on" ? {} : { thinking: { type: "disabled" } });

// Every call to Anthropic's Messages API. `init` is what would be passed to fetch, with a JSON body. Returns
// { capped: "month" | "shopper_day" } without calling when a limit would be passed (see isCapped), otherwise the
// Response (and records what an answered call cost). A network error is thrown, as fetch would.
export async function claudeFetch(env, feature, fetchImpl, init, o = {}) {
  const now = o.now || Date.now();
  let body = {};
  try { body = JSON.parse(init.body); } catch { /* costed as the most a call could be */ }
  const reserve = mostItCouldCost(env, body);
  let why = null;
  try { why = await overLimit(env, { feature, shopperId: o.shopperId, reserve, now }); }
  catch (e) { console.error("ai_spend_check_failed", String(e && e.message || e).slice(0, 120)); why = "unknown"; }
  if (why) { console.log("ai_capped", feature, why); return { capped: why }; }
  const r = await (fetchImpl || fetch)("https://api.anthropic.com/v1/messages", init);
  // Only an answered call is billed by Anthropic. With no token counts in it, it's counted as the most it could have cost.
  if (r && r.ok) {
    let usage = null;
    try { const j = await r.clone().json(); usage = j && j.usage; } catch { /* below */ }
    if (!usage || typeof usage !== "object") usage = { input_tokens: 0, output_tokens: Number(body.max_tokens) || 4096, guessed: true };
    try { await recordSpend(env, { feature, shopperId: o.shopperId, model: body.model, usage, now }); }
    catch (e) { console.error("ai_spend_record_failed", String(e && e.message || e).slice(0, 120)); }
  }
  return r;
}
export const isCapped = (r) => Boolean(r && r.capped);

// For the health page: this month's spend against the limit, by feature.
export async function spendSummary(env, now = Date.now()) {
  const db = env.RELAY_DB;
  await ensureSpendTables(db);
  const rows = (await db.prepare("SELECT feature, calls, input_tokens AS i, output_tokens AS o, pence FROM ai_spend WHERE month = ? ORDER BY pence DESC").bind(monthOf(now)).all()).results || [];
  const total = rows.reduce((t, r) => t + Number(r.pence || 0), 0), limit = monthlyLimit(env);
  const round = (p) => Math.round(Number(p || 0) * 100) / 100;
  return {
    month: monthOf(now), limitPence: limit, shopperDayLimitPence: shopperDayLimit(env), spentPence: round(total),
    reached: total + 0.0001 >= limit, calls: rows.reduce((t, r) => t + Number(r.calls || 0), 0),
    byFeature: rows.map((r) => ({ feature: r.feature, calls: Number(r.calls || 0), inputTokens: Number(r.i || 0), outputTokens: Number(r.o || 0), pence: round(r.pence) }))
  };
}
