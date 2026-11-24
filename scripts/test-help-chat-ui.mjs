// Browser test: the help chat's look and feel (a tall sheet from the bottom, as Connor asked on 23 Nov 2026). Stubbed
// Relay server; the assistant's answers are made up here.
// Checks: Chat with us (Profile, Help and legal) opens a tall sheet with rounded top corners, Relay's round logo, its name in
// bold, "The team can also help" under it and a round close button at the top right; Relay's messages sit on the left
// in grey bubbles under its small logo and name ("AI assistant" said once, as its own label, never glued on with a dot);
// the shopper's sit on the right in the accent blue with white words, fully rounded; topics are outlined pills, wrapped
// and on the right; tapping one says it as the shopper's message, nothing goes to the assistant until a question is
// tapped or written, and Back goes up a level; three soft dots while it writes; a double tap acts once; the box stays
// above the keyboard with the newest message in sight; a swipe down, the close button and Escape close it; bigger text
// still fits; everything is 44px to tap, 13px or more, and passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, openAccountRow } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "pat.sample@example.com";
const st = { chats: [], handoffs: [], fail: null };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/my/help/chat" && m === "GET") return j({ available: true, handoff: true });
  if (p === "/relay/my/help/chat" && m === "POST") {
    st.chats.push(body());
    await new Promise(r => setTimeout(r, 700));
    if (st.fail) { const f = st.fail; st.fail = null; return j({ error: f.error, detail: "upstream 529 overloaded_error" }, f.status); }
    return j({ reply: "A stand-in answer from the test. Open Receipts, tap the receipt, then Return it." });
  }
  if (p === "/relay/my/help/handoff") { st.handoffs.push(body()); return j({ ok: true, replyTo: EMAIL }); }
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Pat Sample", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const chat = page.locator(".rl-back .rl-hc");
const pills = () => chat.locator(".rl-hc-qr-b").allInnerTexts().then(a => a.map(t => t.trim()));
const rect = (loc) => loc.evaluate(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom, bg: c.backgroundColor, color: c.color, radius: parseFloat(c.borderTopLeftRadius), rightRadius: parseFloat(c.borderTopRightRadius), border: parseFloat(c.borderTopWidth), font: parseFloat(c.fontSize), weight: Number(c.fontWeight) }; });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " textarea")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→←✓✕×+➤]|\p{Extended_Pictographic}/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    if (/ [·•] /.test(el.textContent)) out.dots.push(el.textContent.trim().slice(0, 40));
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  const sh = document.querySelector(scope);
  if (document.documentElement.scrollWidth > innerWidth + 1 || (sh && sh.scrollWidth > sh.clientWidth + 1)) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(".rl-hc"), { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/help-chat-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const openAsk = async () => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, EMAIL);
  await page.goto(origin + "/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#foot button").length === 4);
  await page.evaluate(() => window.tabTap("ask"));
  await page.locator("#askPage .rl-ask-pill").first().waitFor();
};
// The chat with its topics: Carry on your chat on the Ask tab once one is under way; before that, Chat with us in
// Profile's Help and legal (the Ask tab itself only offers three questions to send: Connor, 24 Nov 2026).
const openChat = async () => {
  const carry = page.locator("#askPage .rl-ask-pill", { hasText: "Carry on your chat" });
  if (await carry.count()) await carry.click(); else await openAccountRow(page, "Chat with us");
  await chat.waitFor(); await page.waitForTimeout(450); };
const accent = await (async () => { await openAsk(); return page.evaluate(() => { const p = document.createElement("span"); p.style.color = "var(--rl-accent)"; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }); })();
const greyCard = await page.evaluate(() => { const p = document.createElement("span"); p.style.background = "var(--rl-card)"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });

// 1. The sheet: tall, rounded at the top, Relay's logo and name, a round close button at the top right.
await openChat();
{ const vh = await page.evaluate(() => innerHeight), sh = await rect(chat);
  assert.ok(sh.h >= vh * 0.85 && Math.round(sh.bottom) === vh, "a tall sheet from the bottom (" + Math.round(sh.h) + " of " + vh + "px)");
  assert.ok(sh.radius >= 20 && sh.rightRadius >= 20, "rounded top corners");
  const logo = await rect(chat.locator(".rl-hc-head .rl-hc-logo")), name = await rect(chat.locator(".rl-hc-name")), sub = chat.locator(".rl-hc-t > span");
  assert.ok(logo.w >= 40 && logo.radius >= logo.w / 2 - 1, "Relay's round logo");
  assert.equal((await chat.locator(".rl-hc-name").innerText()).trim(), "Relay");
  assert.ok(name.weight >= 600 && name.font >= 19, "the name in bold");
  assert.equal((await sub.innerText()).trim(), "The team can also help", "a short grey line under it");
  assert.ok((await rect(sub)).font < name.font, "smaller than the name");
  const x = await rect(chat.getByRole("button", { name: "Close" }));
  assert.ok(x.w >= 44 && x.h >= 44 && x.radius >= x.w / 2 - 1, "a round close button, 44px or more");
  assert.ok(sh.right - x.right <= 20 && x.y - sh.y <= 40, "at the top right");
  assert.equal(await chat.locator(".rl-hc-x svg").count(), 1, "a drawn icon, not a symbol"); }
// Relay's first message: on the left in grey, under its small logo and name; "AI assistant" is its own label.
{ const first = chat.locator(".rl-chat-b.bot").first(), b = await rect(first), sh = await rect(chat);
  assert.ok(b.x - sh.x <= 20 && b.bg === greyCard, "Relay's message on the left in a grey bubble");
  assert.ok(b.radius >= 18, "rounded");
  assert.equal(await first.locator(".rl-hc-who .rl-hc-logo").count(), 1, "with its small logo");
  assert.deepEqual(await first.locator(".rl-hc-who > b, .rl-hc-who > .rl-hc-ai").allInnerTexts(), ["Relay", "AI assistant"], "its name, and AI assistant as a label of its own");
  assert.match(await first.innerText(), /I'm an AI, so I can get things wrong\./);
  assert.equal(await chat.getByText(/can get things wrong/).count(), 1, "said once");
  assert.equal(await chat.getByText(/^Relay keeps no copy of this chat/).count(), 1, "what is kept, said once"); }
// Topics: outlined pills, wrapped and on the right.
assert.deepEqual(await pills(), ["Where's my receipt?", "How do returns work?", "How does a swap work?", "Something else", "Talk to a person"]);
{ const list = await chat.locator(".rl-hc-list").evaluate(e => ({ right: e.getBoundingClientRect().left + e.clientWidth })), all = await chat.locator(".rl-hc-qr-b").evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(), c = getComputedStyle(b); return { top: Math.round(r.top), right: r.right, h: r.height, border: parseFloat(c.borderTopWidth), color: c.color, bg: c.backgroundColor, font: parseFloat(c.fontSize), radius: parseFloat(c.borderTopLeftRadius) }; }));
  const sheetBg = (await rect(chat)).bg;
  const lines = {}; for (const p of all) lines[p.top] = Math.max(lines[p.top] || 0, p.right);
  assert.ok(Object.keys(lines).length >= 2, "the pills wrap onto more than one line");
  for (const end of Object.values(lines)) assert.ok(Math.abs(list.right - 16 - end) <= 1, "each line of pills ends on the right (" + Math.round(end) + " vs " + Math.round(list.right - 16) + ")");
  for (const p of all) {
    assert.ok(p.h >= 44 && p.font >= 16 && p.border >= 1 && p.color === accent && p.bg === sheetBg && p.radius >= p.h / 2 - 1, "an outlined pill in the accent colour, 44px or more, 16px words");
  } }
assert.equal(await chat.getByRole("button", { name: "Back" }).count(), 0, "no Back at the top level");
await polished("topics");
console.log("ok - a tall sheet with Relay's logo, name and a round close; Relay on the left in grey with AI assistant once; topics as outlined pills on the right");

// 2. A topic is said as the shopper's message, on the right in blue; Relay asks what about it; nothing goes to the assistant.
await chat.getByRole("button", { name: "How do returns work?" }).dblclick(); // a double tap acts once
await page.waitForTimeout(300);
{ const mine = chat.locator(".rl-chat-b.me"), sh = await rect(chat);
  assert.deepEqual(await mine.allInnerTexts(), ["How do returns work?"], "said once, as the shopper's message");
  const p = await rect(mine.locator("p"));
  assert.ok(sh.right - p.right <= 20, "on the right");
  assert.equal(p.bg, accent, "in the accent blue");
  assert.equal(p.color, "rgb(255, 255, 255)", "with white words");
  assert.ok(p.radius >= p.h / 2 - 1, "fully rounded");
  assert.ok(p.font >= 17, "big, readable words");
  assert.equal((await chat.locator(".rl-chat-b.bot").last().locator("p").innerText()).trim(), "What would you like to know?"); }
assert.deepEqual(await pills(), ["How do I return something?", "How long do I have to return something?", "Where's my refund?", "Talk to a person", "Back"]);
assert.equal(await chat.locator(".rl-hc-qr-b").last().locator("svg").count(), 1, "Back has a drawn chevron");
assert.equal(st.chats.length, 0, "a topic asks the assistant nothing");
// Back goes up a level.
await chat.getByRole("button", { name: "Back" }).click();
assert.equal(await chat.locator(".rl-chat-b.me").count(), 0, "what was tapped goes");
assert.deepEqual(await pills(), ["Where's my receipt?", "How do returns work?", "How does a swap work?", "Something else", "Talk to a person"], "back to the topics");
console.log("ok - a topic is the shopper's blue message on the right, Relay asks what about it, Back goes up a level, nothing is sent");

// 3. A question: sent once (even on a double tap), three soft dots while it writes, the answer on the left.
await chat.getByRole("button", { name: "How do returns work?" }).click();
await chat.getByRole("button", { name: "Where's my refund?" }).dblclick();
await chat.locator(".rl-chat-typing").waitFor();
{ assert.equal(await chat.locator(".rl-chat-typing .rl-hc-dots i").count(), 3, "three dots");
  assert.equal(await chat.locator(".rl-hc-qr-b").count(), 0, "nothing to tap while it writes");
  assert.equal(await chat.locator(".rl-chat-typing").evaluate(e => [...e.querySelectorAll("*")].some(n => /rotate|spin/i.test(getComputedStyle(n).animationName))), false, "no spinner");
  assert.equal(await chat.locator(".rl-chat-typing").evaluate(e => getComputedStyle(e).backgroundColor), greyCard, "in a grey bubble like Relay's"); }
await chat.getByText(/A stand-in answer from the test/).waitFor();
await page.waitForTimeout(300);
assert.deepEqual(st.chats, [{ messages: [{ role: "user", text: "Where's my refund?" }] }], "only the question goes, once");
assert.deepEqual(await pills(), ["Ask something else", "Talk to a person"], "then: another question, or a person");
// A typed question, sent with a double tap: once, with the chat so far.
const box = chat.getByRole("textbox", { name: "Your question for Relay's assistant" });
await box.fill("And for a gift?");
await chat.getByRole("button", { name: "Send", exact: true }).dblclick();
await chat.getByText(/A stand-in answer/).nth(1).waitFor();
await page.waitForTimeout(300);
assert.equal(st.chats.length, 2, "a double tap on send sends once");
assert.deepEqual(st.chats[1].messages.map(t => t.role + ":" + t.text.slice(0, 12)), ["user:Where's my r", "assistant:A stand-in a", "user:And for a gi"], "the chat so far goes with it, never the topics tapped");
// Cleaner (Connor, 24 Nov 2026): nothing floats in the conversation but the messages and the pills; no search link.
assert.equal(await chat.getByText(/Search your receipts/).count(), 0, "no search link in the chat");
assert.equal(await chat.locator(".rl-chat-b.me > :not(p)").count(), 0, "the shopper's messages are just their words");
// An error is plain English, and the question comes back.
st.fail = { status: 500, error: "upstream_error" };
await box.fill("One more thing"); await box.press("Enter");
await chat.getByText("The assistant couldn't answer just now. Try again in a moment, or tap Talk to a person.").waitFor();
assert.equal(await chat.getByText(/upstream|529|overloaded|error/i).count(), 0, "no raw error text");
assert.equal(await box.inputValue(), "One more thing");
await polished("answered");
console.log("ok - a question goes once with three soft dots while it writes; double taps act once; errors are plain English");

// 4. The keyboard: the box sits on it, with the newest message in sight and the header still there.
await box.focus();
await page.evaluate(() => document.documentElement.style.setProperty("--rl-kb", "336px"));
await page.waitForTimeout(400);
{ const vh = await page.evaluate(() => innerHeight), bar = await rect(chat.locator(".rl-chat-bar")), list = await rect(chat.locator(".rl-hc-list")), head = await rect(chat.locator(".rl-hc-head"));
  const lastThing = await chat.locator(".rl-hc-list > *").last().evaluate(e => e.getBoundingClientRect().bottom);
  assert.ok(bar.bottom <= vh - 336 + 1, "the box is above the keyboard (" + Math.round(bar.bottom) + " vs " + (vh - 336) + ")");
  assert.ok(head.y >= 0, "the top of the chat is still on screen");
  assert.ok(lastThing <= list.bottom + 1 && lastThing > list.y, "the newest message is in sight");
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.matches(".rl-hc .rl-chat-in")), "still typing"); }
await page.screenshot({ path: "/tmp/shots/help-chat-keyboard.png" });
await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.setProperty("--rl-kb", "0px"); });
console.log("ok - with the keyboard up, the box sits on it and the newest message stays in sight");

// 5. Something else and Talk to a person: write it, and it goes to Relay's team.
await chat.getByRole("button", { name: "Ask something else" }).click();
await chat.getByRole("button", { name: "Something else" }).click();
assert.equal((await chat.locator(".rl-chat-b.bot").last().locator("p").innerText()).trim(), "Write your question below and send it.");
assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.matches(".rl-hc .rl-chat-in")), "the box is ready to write in");
await page.evaluate(() => document.activeElement.blur());
await chat.getByRole("button", { name: "Back" }).click();
assert.deepEqual(await pills(), ["Where's my receipt?", "How do returns work?", "How does a swap work?", "Something else", "Talk to a person", "Back"], "one level up: the topics");
await page.waitForTimeout(500); // (two taps on the same spot in quick succession count as one double tap)
await chat.getByRole("button", { name: "Back" }).click();
assert.deepEqual(await pills(), ["Ask something else", "Talk to a person"], "two levels up, back after the answer");
console.log("ok - Something else asks for the question; Back steps up one level at a time");

// 6. Bigger text still fits.
await page.evaluate(() => { for (const e of document.querySelectorAll(".rl-hc, .rl-hc *")) { const c = getComputedStyle(e); e.style.setProperty("font-size", parseFloat(c.fontSize) * 1.3 + "px", "important"); if (/px$/.test(c.lineHeight)) e.style.setProperty("line-height", parseFloat(c.lineHeight) * 1.3 + "px", "important"); } });
await page.waitForTimeout(200);
{ const vw = await page.evaluate(() => innerWidth), x = await rect(chat.getByRole("button", { name: "Close" })), bar = await rect(chat.locator(".rl-chat-bar"));
  assert.equal(await chat.evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.querySelector(".rl-hc-list").scrollWidth <= e.querySelector(".rl-hc-list").clientWidth + 1), true, "nothing sideways");
  assert.ok(x.right <= vw && x.w >= 44, "the close button is still whole");
  assert.ok(bar.bottom <= (await page.evaluate(() => innerHeight)) + 1, "the box is still on screen");
  const cut = await chat.locator(".rl-hc-qr-b, .rl-hc-name, .rl-hc-t > span").evaluateAll(es => es.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText));
  assert.deepEqual(cut, [], "no words cut off"); }
await page.screenshot({ path: "/tmp/shots/help-chat-bigger-text.png" });
console.log("ok - with bigger text nothing goes sideways or gets cut off");

// 7. Closing: the close button, a swipe down, and Escape. The chat is kept while Relay is open.
await chat.getByRole("button", { name: "Close" }).click();
await chat.waitFor({ state: "detached" });
await openChat();
assert.ok(await chat.getByText("Where's my refund?").count() >= 1, "the chat carries on where it was left");
const swipe = await chat.locator(".rl-hc-head").evaluate(async h => {
  const r = h.getBoundingClientRect(), x = r.left + 80, y = r.top + 20;
  const t = (yy) => new Touch({ identifier: 1, target: h, clientX: x, clientY: yy });
  h.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(y)], changedTouches: [t(y)] }));
  for (let i = 1; i <= 8; i++) { h.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(y + i * 40)], changedTouches: [t(y + i * 40)] })); await new Promise(r => setTimeout(r, 16)); }
  h.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t(y + 320)] }));
  return true;
});
assert.ok(swipe);
await chat.waitFor({ state: "detached", timeout: 3000 });
await openChat();
await page.keyboard.press("Escape");
await chat.waitFor({ state: "detached", timeout: 3000 });
console.log("ok - the close button, a swipe down and Escape close it; it opens again where it was left");

// 8. Talk to a person before anything is asked: Relay asks for the question, then it goes to the team.
await openAsk(); await openChat();
await chat.getByRole("button", { name: "Talk to a person" }).click();
assert.match(await chat.locator(".rl-chat-b.bot").last().innerText(), /Write your question below and tap send\. Relay's team will reply by email to pat\.sample@example\.com\./);
const toTeam = chat.getByRole("textbox", { name: "Your message to Relay's team" });
assert.equal(await toTeam.getAttribute("placeholder"), "Write to Relay's team");
await toTeam.fill("My receipt shows the wrong shop");
await chat.getByRole("button", { name: "Send to Relay's team" }).click();
await page.getByText("Send this to Relay's team? They'll reply by email to " + EMAIL + ".").waitFor();
await page.getByRole("button", { name: "Send", exact: true }).last().click();
await chat.getByText("Sent to Relay's team. They'll reply by email to " + EMAIL + ".").waitFor();
assert.deepEqual(st.handoffs, [{ messages: [{ role: "user", text: "My receipt shows the wrong shop" }] }], "just what was written, once");
assert.equal(st.chats.length, 3, "nothing went to the assistant");
await polished("sent to the team");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS help chat look and feel: a tall sheet like a phone's own support chat, bubbles left and right, topics as pills with Back, once per tap, above the keyboard, bigger text, closes three ways");
await browser.close(); server.close();
