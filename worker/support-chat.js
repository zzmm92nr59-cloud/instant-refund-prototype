// Relay's help chat: an AI assistant (Claude, from Anthropic) that answers questions about using Relay, and "Talk to a
// person", which emails the conversation to Relay's support team.
//
// Rules (do not weaken):
//  * Off until the ANTHROPIC_API_KEY secret is set in Cloudflare (never in code). GET /relay/my/help/chat says whether it's on.
//  * The assistant knows only Relay's help (help-content.js) and a little of the shopper's account that Relay itself keeps:
//    which kinds of inbox are connected, when Relay last checked them, and whether two-step sign-in is on. Nothing read
//    from anyone's email (no receipts, orders, shops or counts of them) and no email address goes to Anthropic, so
//    nothing from Gmail or Outlook is passed on to another company.
//  * It can't do anything in the account and must never promise a refund, a return or what a shop will do.
//  * Relay keeps no copy of the conversation. Only counts are kept (messages and hand-offs per shopper per day, for the
//    limits below and for the Relay health page), and they go after 30 days or with the account.
//  * Limits: CHAT_PER_DAY messages per shopper a day and CHAT_ALL_PER_DAY across everyone, on top of the usual rate limits.
//  * "Talk to a person" sends the conversation, from the shopper's sign-in address, to SUPPORT_EMAIL (or the first Relay
//    admin until there is one), so a person can reply by email. It's sent only when the shopper asks.
import { HELP_QA, APP_FACTS } from "./help-content.js";
import { isAdmin } from "./resale-admin.js";

export const CHAT_PER_DAY = 60;
export const CHAT_ALL_PER_DAY = 3000;
export const HANDOFFS_PER_DAY = 5;
const MAX_TURNS = 12, MAX_CHARS = 1000, KEEP_DAYS = 30;
const DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_FROM = "Relay <onboarding@resend.dev>";
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

export const SUPPORT_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS support_chat_usage (
     shopper_id TEXT NOT NULL, day TEXT NOT NULL, messages INTEGER NOT NULL DEFAULT 0, handoffs INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (shopper_id, day))`
];
async function ensureTables(db) { for (const sql of SUPPORT_TABLE_SQL) await db.prepare(sql).run(); }
export function supportDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM support_chat_usage WHERE shopper_id = ?").bind(shopperId)];
}
export const chatAvailable = (env) => Boolean(env && env.ANTHROPIC_API_KEY);
const supportAddress = (env) => String(env.SUPPORT_EMAIL || "").trim() || String(env.RELAY_ADMIN_EMAILS || "").split(",").map(s => s.trim()).filter(Boolean)[0] || "";

// The conversation as the app sends it: alternating turns, the person's first (and, for the assistant, last), each
// trimmed. Null if unusable.
export function cleanTurns(list, endWithUser = true) {
  if (!Array.isArray(list) || !list.length || list.length > 40) return null;
  const turns = [];
  for (const t of list) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string") return null;
    const text = t.text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (!text || text.length > MAX_CHARS) return null;
    if (turns.length && turns[turns.length - 1].role === t.role) turns[turns.length - 1].text += "\n" + text;
    else turns.push({ role: t.role, text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || (endWithUser && turns[turns.length - 1].role !== "user")) return null;
  // Only the last part of a long chat, still starting with the person.
  const last = turns.slice(-MAX_TURNS);
  while (last.length && last[0].role !== "user") last.shift();
  return last;
}

// What the assistant is told. Exported so the tests can check nothing personal is in it.
export function systemPrompt(account) {
  const qa = HELP_QA.map(([q, a]) => "Q: " + q + "\nA: " + a).join("\n\n");
  return [
    "You are Relay's help assistant, inside the Relay app. Relay finds people's order confirmations and receipts in their Gmail or Outlook (read-only), shows what they can still return and by when, and helps them return or swap things.",
    "",
    "How to answer:",
    "- Help only with Relay and using it. For anything else, say you can only help with Relay.",
    "- Use only the facts below. If they don't answer the question, say you don't know and suggest tapping 'Talk to a person'.",
    "- You can't see the person's receipts, orders or emails, and you can't change anything in their account. Never say you have done or checked something. Tell them where in the app to do it.",
    "- Never promise a refund, a return, a delivery or what a shop will do. Refunds always come from the shop.",
    "- If asked, say you're an AI and can get things wrong.",
    "- Never ask for passwords, sign-in codes, card numbers or other secrets. If someone shares one, tell them not to share it with anyone, including here.",
    "- Be brief and warm: two to five short sentences in plain British English. Use a short numbered list only for steps. No emoji, no markdown headings.",
    "",
    "Facts about Relay:",
    qa,
    "",
    APP_FACTS.map(f => "- " + f).join("\n"),
    "",
    "This person's account (what Relay itself keeps, not anything from their email):",
    "- Inboxes connected: " + (account.inboxes.length ? account.inboxes.join(", ") : "none yet"),
    "- Relay last checked their inbox: " + (account.lastChecked || "not yet"),
    "- Two-step sign-in: " + (account.twoStep ? "on" : "off")
  ].join("\n");
}

async function accountFacts(env, shopper, now) {
  const db = env.RELAY_DB, one = async (sql, ...a) => { try { return await db.prepare(sql).bind(...a).first(); } catch { return null; } };
  const all = async (sql, ...a) => { try { return (await db.prepare(sql).bind(...a).all()).results || []; } catch { return []; } };
  const boxes = await all("SELECT provider, last_scan_at AS last FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?", shopper.id, shopper.id + "~%");
  const twoStep = await one("SELECT enabled FROM auth_totp WHERE shopper_id = ?", shopper.id);
  const phone2 = await one("SELECT two_step AS on2 FROM auth_phone WHERE shopper_id = ?", shopper.id);
  const counts = {};
  for (const b of boxes) { const k = b.provider === "microsoft" ? "Outlook" : "Gmail"; counts[k] = (counts[k] || 0) + 1; }
  const latest = boxes.reduce((m, b) => Math.max(m, Number(b.last) || 0), 0);
  // In UK time, as the shopper sees it.
  const uk = (t, o) => new Date(t).toLocaleString("en-GB", { timeZone: "Europe/London", ...o });
  const dayOf = (t) => uk(t, { year: "numeric", month: "2-digit", day: "2-digit" });
  const lastChecked = latest ? (dayOf(latest) === dayOf(now) ? "today at " + uk(latest, { hour: "2-digit", minute: "2-digit" })
    : uk(latest, { day: "numeric", month: "long", year: "numeric" })) : null;
  return { inboxes: Object.entries(counts).map(([k, n]) => k + (n > 1 ? " (" + n + ")" : "")), lastChecked,
    twoStep: Boolean((twoStep && twoStep.enabled) || (phone2 && phone2.on2)) };
}

async function useOne(env, shopper, now, field, cap) {
  const db = env.RELAY_DB, day = new Date(now).toISOString().slice(0, 10);
  const mine = await db.prepare(`SELECT ${field} AS n FROM support_chat_usage WHERE shopper_id = ? AND day = ?`).bind(shopper.id, day).first();
  if (mine && mine.n >= cap) return false;
  if (field === "messages") {
    const everyone = await db.prepare("SELECT COALESCE(SUM(messages), 0) AS n FROM support_chat_usage WHERE day = ?").bind(day).first();
    if (everyone && everyone.n >= CHAT_ALL_PER_DAY) return false;
  }
  const old = new Date(now - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  await db.batch([
    db.prepare(`INSERT INTO support_chat_usage (shopper_id, day, ${field}) VALUES (?, ?, 1) ON CONFLICT (shopper_id, day) DO UPDATE SET ${field} = ${field} + 1`).bind(shopper.id, day),
    db.prepare("DELETE FROM support_chat_usage WHERE day < ?").bind(old)]);
  return true;
}

// GET /relay/my/help/chat: { available }. POST /relay/my/help/chat { messages }: { reply }.
// POST /relay/my/help/handoff { messages }: emails the conversation to Relay's support team. Null for other paths.
export async function handleSupportRoute(path, method, request, env, cors, shopper, o) {
  if (path !== "/relay/my/help/chat" && path !== "/relay/my/help/handoff") return null;
  const now = (o && o.now) || Date.now(), fetchImpl = (o && o.fetchImpl) || fetch;
  if (path === "/relay/my/help/chat" && method === "GET") return json({ available: chatAvailable(env), handoff: Boolean(env.RESEND_API_KEY && supportAddress(env)) }, 200, cors);
  if (method !== "POST") return json({ error: "not_found" }, 404, cors);
  let body = null; try { body = await request.json(); } catch { body = null; }
  // A hand-off can end with the assistant's answer; the assistant is only ever asked after the person has written.
  const turns = cleanTurns(body && body.messages, path === "/relay/my/help/chat");
  if (!turns) return json({ error: "bad_messages" }, 400, cors);
  await ensureTables(env.RELAY_DB);

  if (path === "/relay/my/help/handoff") {
    const to = supportAddress(env);
    if (!env.RESEND_API_KEY || !to) return json({ error: "handoff_off" }, 503, cors);
    if (!(await useOne(env, shopper, now, "handoffs", HANDOFFS_PER_DAY))) return json({ error: "too_many_requests" }, 429, cors);
    const lines = turns.map(t => (t.role === "user" ? "Shopper: " : "Assistant: ") + t.text).join("\n\n");
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const sent = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || DEFAULT_FROM, to: [to], reply_to: shopper.email, subject: "Relay help: a shopper would like to talk to a person",
        text: "Reply to this email to answer them (it goes to " + shopper.email + ").\n\n" + lines,
        html: "<p>Reply to this email to answer them (it goes to " + esc(shopper.email) + ").</p>" + turns.map(t => "<p><b>" + (t.role === "user" ? "Shopper" : "Assistant") + ":</b> " + esc(t.text).replace(/\n/g, "<br>") + "</p>").join("") })
    }).then(r => r.ok, () => false);
    if (!sent) return json({ error: "handoff_failed" }, 502, cors);
    return json({ ok: true, replyTo: shopper.email }, 200, cors);
  }

  if (!chatAvailable(env)) return json({ error: "chat_off" }, 503, cors);
  if (!(await useOne(env, shopper, now, "messages", isAdmin(env, shopper) ? CHAT_PER_DAY * 5 : CHAT_PER_DAY))) return json({ error: "too_many_requests" }, 429, cors);
  const system = systemPrompt(await accountFacts(env, shopper, now));
  let res;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.SUPPORT_CHAT_MODEL || DEFAULT_MODEL, max_tokens: 450, system,
        messages: turns.map(t => ({ role: t.role, content: t.text })) })
    });
  } catch { return json({ error: "chat_unavailable" }, 502, cors); }
  if (!res || !res.ok) return json({ error: res && res.status === 429 ? "chat_busy" : "chat_unavailable" }, 502, cors);
  const data = await res.json().catch(() => null);
  const reply = data && Array.isArray(data.content) ? data.content.filter(c => c && c.type === "text").map(c => c.text).join("\n").trim() : "";
  if (!reply) return json({ error: "chat_unavailable" }, 502, cors);
  return json({ reply: reply.slice(0, 4000) }, 200, cors);
}
