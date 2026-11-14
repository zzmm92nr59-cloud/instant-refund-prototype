// Browser test: the help chat (Profile, Help & legal). Stubbed Relay server; the assistant's answers are made up here.
// Checks: the row shows only when Relay says the chat (or a person) is there; the page says it's an AI and that Relay
// keeps no copy; a suggested question and a typed one get answers, with greyed outlines while it writes; a double tap
// sends once; errors are plain English and give the question back; "Talk to a person" asks first, then sends the chat;
// on a phone the box to write in sits above the floating tab bar; with the assistant off it's "Contact us" by email.
// Every part passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com";
const st = { available: true, handoff: true, chats: [], handoffs: [], fail: null };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/my/help/chat" && m === "GET") return j({ available: st.available, handoff: st.handoff });
  if (p === "/relay/my/help/chat" && m === "POST") {
    const b = body(); st.chats.push(b);
    await new Promise(r => setTimeout(r, 500));
    if (st.fail) { const f = st.fail; st.fail = null; return j({ error: f.error }, f.status); }
    const q = b.messages[b.messages.length - 1].text;
    return j({ reply: /receipts/i.test(q) ? "With your permission, Relay reads your inbox read-only and picks out order emails.\n1. Open Receipts\n2. Tap a group" : "Open Receipts, tap the receipt, then Fix details." });
  }
  if (p === "/relay/my/help/handoff") { st.handoffs.push(body()); await new Promise(r => setTimeout(r, 200)); return j({ ok: true, replyTo: EMAIL }); }
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/2fa") return j({ app: false, text: false });
  if (p === "/relay/my/phone") return j({ available: true, ending: null });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " textarea")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+➤]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/chat-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const view = page.locator("#mePage");
const open = async () => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, EMAIL);
  await page.goto(origin + "/index.html");
  await page.evaluate(() => window.go("me"));
  await view.locator(".rl-arow").first().waitFor();
};

// 1. Chat off and nobody to write to: no row.
st.available = false; st.handoff = false;
await open();
await view.locator(".rl-arow", { hasText: "Help and legal" }).click();
await view.locator(".rl-arow", { hasText: "Terms of use" }).waitFor();
await page.waitForTimeout(400);
assert.equal(await view.locator(".rl-arow", { hasText: /Chat with us|Contact us/ }).isVisible(), false);
console.log("ok - no chat row when there's no assistant and no one to write to");

// 2. The assistant is on: it is the Ask tab (and not a row in Help and legal any more).
st.available = true; st.handoff = true;
await open();
await view.locator(".rl-arow", { hasText: "Help and legal" }).click();
await view.locator(".rl-arow", { hasText: "Terms of use" }).waitFor(); await page.waitForTimeout(400);
assert.equal(await view.locator(".rl-arow", { hasText: /Chat with us|Contact us/ }).count(), 0, "with the assistant on, it's the Ask tab, not a row");
await page.evaluate(() => window.tabTap("ask"));
const ask = page.locator("#askPage");
await ask.getByText("Relay's assistant is an AI, so it can get things wrong.").waitFor();
await ask.getByText(/Relay keeps no copy of this chat/).waitFor();
await polished("start", "#askPage");
// A suggested question: the outline while it writes, then the answer, under the assistant saying it's an AI.
await ask.getByRole("button", { name: "How does Relay find my receipts?" }).click();
await ask.locator(".rl-chat-typing").waitFor();
await ask.getByText("Hi, I'm Relay's assistant. I'm an AI, so I can get things wrong.", { exact: false }).waitFor();
await ask.getByText(/picks out order emails/).waitFor();
assert.equal(await ask.locator(".rl-chat-typing").count(), 0);
assert.deepEqual(st.chats[0], { messages: [{ role: "user", text: "How does Relay find my receipts?" }] });
assert.equal(await ask.getByRole("button", { name: "A receipt is missing" }).count(), 0, "suggestions go once the chat has started");
assert.match(await ask.locator(".rl-chat-b.bot p").last().innerText(), /\n1\. Open Receipts\n2\. Tap a group$/, "the answer's lines are kept, as plain text");
// A typed question, sent with a double tap: once.
const box = ask.getByRole("textbox", { name: "Your question for Relay's assistant" });
await box.fill("My total is wrong");
await ask.getByRole("button", { name: "Send", exact: true }).dblclick();
await ask.getByText("Open Receipts, tap the receipt, then Fix details.").waitFor();
assert.equal(st.chats.length, 2, "a double tap sends once");
assert.deepEqual(st.chats[1].messages.map(t => t.role), ["user", "assistant", "user"], "the conversation so far goes with it");
// Errors: plain English, and the question comes back to the box.
st.fail = { status: 429, error: "too_many_requests" };
await box.fill("One more thing");
await box.press("Enter");
await ask.getByText("That's a lot of messages for one day. Tap Talk to a person, or try again tomorrow.").waitFor();
assert.equal(await box.inputValue(), "One more thing", "the question isn't lost");
st.fail = { status: 503, error: "chat_off" };
await ask.getByRole("button", { name: "Send", exact: true }).click();
await ask.getByText("The assistant is off right now. Tap Talk to a person and Relay's team will email you.").waitFor();
// On a phone, the box sits above the floating tab bar (once the keyboard is down: while typing, the tab bar steps aside
// and the box sits on the keyboard).
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.waitForFunction(() => !document.body.classList.contains("typing"));
const gap = await page.evaluate(() => { const bar = document.querySelector(".rl-chat-bar").getBoundingClientRect(), nav = document.querySelector(".footnav").getBoundingClientRect(); return nav.top - bar.bottom; });
assert.ok(gap >= 4, "the box to write in sits above the tab bar (gap " + gap + "px)");
await polished("chat", "#askPage");
console.log("ok - the assistant: says it's an AI, outlines while it writes, answers, sends once, plain errors, above the tab bar");

// 3. Talk to a person: asks first, sends the chat (with what's in the box), and says where the reply will go.
await ask.getByRole("button", { name: "Talk to a person" }).click();
await page.getByText("Send this to Relay's team? They'll reply by email to " + EMAIL + ".").waitFor();
await page.getByRole("button", { name: "Send", exact: true }).last().click();
await ask.getByText("Sent to Relay's team. They'll reply by email to " + EMAIL + ".").waitFor();
assert.equal(st.handoffs.length, 1);
const sent = st.handoffs[0].messages;
assert.deepEqual(sent[sent.length - 1], { role: "user", text: "One more thing" }, "what was in the box goes too");
assert.ok(sent.some(t => t.role === "assistant"), "with the assistant's answers");
console.log("ok - Talk to a person asks first, then sends the chat");

// 4. Assistant off, a person on: "Contact us".
st.available = false; st.handoff = true; st.handoffs = [];
await open();
await view.locator(".rl-arow", { hasText: "Help and legal" }).click();
const contact = view.locator(".rl-arow", { hasText: "Contact us" });
await contact.waitFor();
await contact.click();
await view.getByText("Write your question and tap send. Relay's team will reply by email to " + EMAIL + ".").waitFor();
assert.equal(await view.getByRole("button", { name: "Talk to a person" }).count(), 0);
await view.getByRole("textbox", { name: "Your message to Relay's team" }).fill("Can I use Relay with Yahoo Mail?");
await view.getByRole("button", { name: "Send to Relay's team" }).click();
await page.getByRole("button", { name: "Send", exact: true }).last().click();
await view.getByText("Sent to Relay's team. They'll reply by email to " + EMAIL + ".").waitFor();
assert.deepEqual(st.handoffs[0], { messages: [{ role: "user", text: "Can I use Relay with Yahoo Mail?" }] });
await polished("contact", "#mePage .rl-asub");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS help chat UI: shown only when on, an AI that says so, answers, once per tap, plain errors, a person by email, Contact us without the AI");
await browser.close(); server.close();
