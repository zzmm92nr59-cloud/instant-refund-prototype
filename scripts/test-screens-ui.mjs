// Browser test: every screen and sheet of the app, looked at the way a person sees it (Connor, 23 Nov 2026: problems he
// found on his phone that tests comparing data had missed: a takeaway named after a dish, "Return today" on in-game coins,
// the Watching page with overlapping boxes). Stubbed Relay server; a made-up shopper with a full, messy account
// (scripts/fixtures/screens-world.mjs), a brand-new shopper with nothing yet, and someone not signed in.
// Each screen is opened on an iPhone-size screen, again with every piece of text 30% bigger, and at desktop width, and
// checked for what a person would notice:
//   - text overlapping other text, or a box overlapping a box beside it;
//   - something left under the floating tab bar once scrolled to the bottom;
//   - sideways scroll, or something running off the right of the screen;
//   - everyday text under 13px (uppercase labels 12px);
//   - anything tappable under 44px tall;
//   - a short label, a price or a date cut off with "…" (long product names may wrap or clamp);
//   - facts glued together with dots, raw error text or codes, test wording.
// SHOTS=<folder> also saves a screenshot of each (deviceScaleFactor 1). AUDIT=1 lists every problem instead of stopping.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname, join } from "node:path";
import { skipInterests, homeReady, waitOutDoubleTap, tapPicture, openSettings } from "./relay-places.mjs";
import * as W from "./fixtures/screens-world.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".html": "text/html", ".webmanifest": "application/manifest+json" };
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.SHOTS || ""; if (SHOTS) await mkdir(SHOTS, { recursive: true });
const AUDIT = process.env.AUDIT === "1", ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const svgLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="14" y="44" width="100" height="40" rx="8" fill="#0d6e4f"/></svg>`;

// The stubbed Relay server, for each kind of person.
function stub(who) {
  const full = who === "full", RECEIPTS = full ? W.receipts() : [], email = full ? "rowan.example@example.com" : "new.person@example.com";
  return async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (u.hostname === "img.example") return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: H, body: p.startsWith("/tall/") ? W.svgTall : W.svgSq(Number(p.replace(/\D+/g, "")) || 1) });
    if (!p.startsWith("/relay/")) return route.abort();
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) }).catch(() => {});
    if (p.startsWith("/relay/my/logo/")) return decodeURIComponent(p.split("/").pop()) === "kestrel.example" ? route.fulfill({ status: 200, contentType: "image/svg+xml", headers: H, body: svgLogo }) : route.fulfill({ status: 404, headers: H, body: "" });
    if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/original$/.test(p)) return j({ html: '<table width="600"><tr><td><h1>Thanks for your order</h1><p>Order ZX40002. Wool Coat, UK 10: £120.00. Cashmere Beanie: £35.00. Leather Gloves, M: £45.00.</p><p>Total £200.00</p></td></tr></table>', links: [] });
    if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/image$/.test(p)) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/auth/providers") return j({ google: true, microsoft: true, apple: false, phone: true, consent: { version: "v5", text: ["To work, Relay needs to see your receipts."] } });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
    if (p === "/relay/my/gmail") return full ? j({ connected: true, provider: "google", email, lastScanAt: Date.now() - 6e5, maxInboxes: 5,
      others: [{ provider: "microsoft", email: "rowan.work@example.com", lastScanAt: Date.now() - 36e5 }] }) : j({ connected: false, maxInboxes: 5 });
    if (p === "/relay/my/receipts") return j({ receipts: RECEIPTS });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email, name: full ? "Rowan Example" : null, photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    if (p === "/relay/shopify/catalogue") return j({ published: true, products: full ? W.products() : [] });
    if (p === "/relay/my/admin/me") return j(full ? { admin: true, openReports: 0 } : { admin: false });
    if (p === "/relay/my/admin/review-account") return j({ on: false });
    if (p === "/relay/my/admin/health") return j(W.health());
    if (p === "/relay/my/2fa") return j({ required: false, enrolled: true, verified: true, methods: ["passkey"], app: false, text: false });
    if (p === "/relay/my/phone") return j({ available: true, ending: null });
    if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
    if (p === "/relay/my/bank") return j(full ? W.bank() : { available: true, testBanks: false, choices: ["amex", "monzo"], connections: [] });
    if (p === "/relay/my/bank/payments") return j(full ? W.bankPayments() : { payments: [] });
    if (p === "/relay/my/wrapped") return j(full ? W.wrapped(RECEIPTS) : { receipts: 0, years: [] });
    if (p === "/relay/my/help/chat") return j({ available: true, messages: [] });
    if (p === "/relay/my/delivery") return j({ delivery: null });
    if (p === "/relay/my/interests") return j({ interests: ["fashion", "home"] });
    if (p === "/relay/my/passkeys") return j({ passkeys: [] });
    if (p === "/relay/my/devices") return j({ devices: [] });
    return j({});
  };
}

// What a person would notice on the screen now showing. Checks the top layer only: the last open sheet, or the page.
const CHECK = (opts) => {
  const out = [], seen = new Set(), add = (kind, what) => { const k = kind + ": " + what; if (!seen.has(k)) { seen.add(k); out.push(k); } };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return (!el.checkVisibility || el.checkVisibility({ contentVisibilityAuto: true })) && r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  // The top layer: the last open sheet, or a page laid over the whole screen (the welcome), or the page itself.
  const sheets = [...document.querySelectorAll(".rl-back")].filter(vis);
  const cover = sheets.length ? null : [...document.body.children].filter(e => { if (!vis(e) || getComputedStyle(e).position !== "fixed") return false; const r = e.getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }).pop();
  const layer = sheets.length ? sheets[sheets.length - 1] : cover || document.body;
  const label = el => ((el.getAttribute && el.getAttribute("aria-label")) || el.innerText || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 50);
  const W = innerWidth, Hh = innerHeight;
  // Whether a point of el is actually shown (not clipped away by an ancestor that hides overflow, or off screen).
  const clipped = (el, r) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.overflowX !== "visible" || s.overflowY !== "visible") { const q = n.getBoundingClientRect(); if (r.right <= q.left + 1 || r.left >= q.right - 1 || r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return true; } } return false; };
  const inLayer = el => layer.contains(el) && !(layer === document.body && el.closest(".rl-back"));
  // Only the part of a rectangle that is actually shown (inside every box that hides what spills out of it).
  const shown = (el, r) => { let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom; for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.overflowX !== "visible" || s.overflowY !== "visible") { const q = n.getBoundingClientRect(); x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom); } } return x1 - x0 > 1 && y1 - y0 > 1 ? { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 } : null; };
  const skel = el => el.closest(".rl-skel, .rl-sr, .rl-ptr, svg");
  // Text pieces: each run of text, as drawn.
  const texts = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let t; (t = walker.nextNode());) {
    if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el || !inLayer(el) || !vis(el) || skel(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    for (const r0 of rg.getClientRects()) { const r = r0.width > 1 && r0.height > 1 ? shown(el, r0) : null; if (r && r.bottom > 0 && r.top < Hh) texts.push({ el, r, t: t.textContent.trim().slice(0, 40) }); }
    const s = getComputedStyle(el), px = parseFloat(s.fontSize), txt = t.textContent.trim(), k = opts.scale && el.dataset.big ? opts.scale : 1;
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(txt) && txt === txt.toUpperCase());
    if (txt.length > 1 && px < 13 * k - 0.01 && !(caps && px >= 12 * k - 0.01)) add("text under 13px", txt.slice(0, 40) + " (" + px + "px)");
    if (/ · /.test(txt)) add("facts joined with dots", txt.slice(0, 60));
    if (/\b(undefined|null|NaN|\[object|[a-z]+_[a-z_]+|HTTP \d{3}|Error:)/.test(txt) && !el.closest("input, textarea, code")) add("raw text or code", txt.slice(0, 60));
    if (!opts.testtools && /\b(sandbox|demo|test shop)\b/i.test(txt)) add("test wording", txt.slice(0, 60));
  }
  const floats = e => { for (let n = e; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return true; } return false; };
  // Text over text (two different runs drawn on top of each other).
  for (let i = 0; i < texts.length; i++) for (let k = i + 1; k < texts.length; k++) {
    const a = texts[i], b = texts[k]; if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || floats(a.el) !== floats(b.el)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 3 && y > Math.min(a.r.height, b.r.height) * 0.5) add("text over text", '"' + a.t + '" / "' + b.t + '"');
  }
  // Text covered by something else drawn on top of it (a box, a badge), other than what floats on purpose: the tab bar,
  // Home's pinned header, a sheet's own bar.
  for (const a of texts) {
    if (a.r.top < 0 || a.r.bottom > Hh || a.r.left < 0 || a.r.right > W) continue;
    const pts = [[a.r.left + a.r.width / 2, a.r.top + a.r.height / 2], [a.r.left + 3, a.r.top + a.r.height / 2], [a.r.right - 3, a.r.top + a.r.height / 2]];
    // (Text that lets taps through, like a "£" drawn inside a price box, is found too: it is made findable for the check.)
    const pe = a.el.style.pointerEvents; a.el.style.pointerEvents = "auto";
    const hits = pts.map(([x, y]) => document.elementFromPoint(x, y)); a.el.style.pointerEvents = pe;
    for (const e of hits) { if (!e || e === a.el || a.el.contains(e) || e.contains(a.el) || floats(e) && !floats(a.el) || e.closest(".rl-sr")) continue;
      add("text covered", '"' + a.t + '" under ' + label(e)); break; }
  }
  // Cards or buttons over the card or button beside them.
  // (Not a link inside a sentence: when the sentence wraps, its links' tap areas meet, as on any page of text.)
  const tapbox = el => { const s = getComputedStyle(el); const inSentence = /^inline/.test(s.display) && el.parentElement && [...el.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); return s.position !== "absolute" && s.position !== "fixed" && !inSentence && el.matches("button, a, [role=button], .rl-po, .h2-item, .wl-card, .hl-sq, .rl-rr"); };
  for (const parent of layer.querySelectorAll("*")) {
    if (!inLayer(parent) || skel(parent)) continue;
    const kids = [...parent.children].filter(k => vis(k) && tapbox(k) && !skel(k)); if (kids.length < 2) continue;
    const rs = kids.map(k => k.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++) for (let k = i + 1; k < kids.length; k++) {
      const a = rs[i], b = rs[k], x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 2 && y > 2 && a.bottom > 0 && b.bottom > 0 && a.top < Hh && b.top < Hh && !clipped(kids[i], a) && !clipped(kids[k], b)) add("box over box", label(kids[i]) + " / " + label(kids[k]));
    }
  }
  // Tappables.
  for (const el of layer.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select, textarea, [onclick]")) {
    if (!inLayer(el) || !vis(el) || el.closest(".rl-skel")) continue;
    if (el.tagName === "INPUT" && /checkbox|radio/.test(el.type) && el.closest("label")) continue;
    const r = el.getBoundingClientRect(); if (clipped(el, r) || r.bottom < 0 || r.top > Hh) continue;
    if (r.height < 43.5) add("tappable under 44px", label(el) + " (" + Math.round(r.height) + "px)");
  }
  // Cut off with "…": short labels, prices and dates must be whole.
  for (const el of layer.querySelectorAll("*")) {
    if (!inLayer(el) || !vis(el) || skel(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), txt = el.textContent.replace(/\s+/g, " ").trim();
    const cut = (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) || (s.webkitLineClamp && s.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 2);
    // (What was bought, on a line that keeps its date, may give way: the date and price are what matter there.)
    const tap = el.closest("button, a, [role=button]"), alone = tap && tap.innerText.replace(/\s+/g, " ").trim() === txt;
    if (cut && (/[£€$]\s?\d|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\d+ days? left|today|tomorrow/i.test(txt) || /^H[1-4]$/.test(el.tagName) || (alone && txt.length <= 30))) add("cut off", txt.slice(0, 50));
  }
  // Sideways.
  if (document.documentElement.scrollWidth > W + 1) add("sideways scroll", document.documentElement.scrollWidth + "px wide");
  for (const el of layer.querySelectorAll("*")) {
    if (!inLayer(el) || !vis(el) || skel(el)) continue; const r = el.getBoundingClientRect();
    if (r.right > W + 1 && !clipped(el, r) && !el.closest("[style*=overflow], .h2-chips") ) { let sc = false; for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { sc = true; break; } } if (!sc) add("off the right edge", label(el)); }
  }
  return out;
};
// Something under the tab bar once scrolled to the bottom (phone only; the page, not a sheet).
const UNDER_BAR = () => {
  const bar = document.querySelector("#foot"); if (!bar || !bar.getClientRects().length || document.querySelector(".rl-back")) return [];
  const top = bar.getBoundingClientRect().top, out = [];
  const view = document.querySelector("#view"); if (!view) return [];
  for (const el of view.querySelectorAll("button, a, p, h2, h3, li, .rl-po, img, b, span")) {
    const s = getComputedStyle(el); if (s.position === "fixed" || s.position === "sticky" || el.closest(".h2-band, .rl-skel")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || s.visibility === "hidden") continue;
    if (r.bottom > top + 1 && r.top < innerHeight) out.push("under the tab bar: " + ((el.innerText || el.getAttribute("aria-label") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 50)));
  }
  return [...new Set(out)].slice(0, 5);
};

const CONFIGS = [
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "bigtext", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, scale: 1.3 },
  { name: "desktop", viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false },
];
const problems = [];
const browser = await chromium.launch();
async function person(cfg, who, search = "") {
  const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1, isMobile: cfg.isMobile, hasTouch: cfg.hasTouch, serviceWorkers: "block" });
  if (who !== "out") await skipInterests(ctx);
  await ctx.addInitScript(([who, email, w]) => { try {
    if (who !== "out") localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email, expiresAt: Date.now() + 864e5 }));
    if (who === "full") { if (!localStorage.getItem("relay-radar-v2")) localStorage.setItem("relay-radar-v2", JSON.stringify(w)); localStorage.setItem("relay.mailbox", "gmail"); }
  } catch (e) {} }, [who, who === "full" ? "rowan.example@example.com" : "new.person@example.com", W.watches()]);
  await ctx.route("https://**/*", stub(who));
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html" + search);
  return { ctx, page, errors };
}
// Bigger text: every piece of text on the screen 30% larger (what a phone's bigger text setting does).
const bigger = (page) => page.evaluate(() => { for (const e of document.querySelectorAll("body *")) { if (e.dataset.big) continue; e.dataset.big = 1; const c = getComputedStyle(e); e.style.setProperty("font-size", parseFloat(c.fontSize) * 1.3 + "px", "important"); if (c.lineHeight !== "normal" && /px$/.test(c.lineHeight)) e.style.setProperty("line-height", parseFloat(c.lineHeight) * 1.3 + "px", "important"); } });
const settle = (page, ms = 500) => page.waitForTimeout(ms);
async function look(page, cfg, name, { testtools = false, bar = true } = {}) {
  await settle(page, 350);
  if (cfg.scale) { await bigger(page); await settle(page, 200); }
  const found = await page.evaluate(CHECK, { scale: cfg.scale || 1, testtools });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, cfg.name + "-" + name + ".png") });
  if (bar && cfg.name !== "desktop") {
    const sheetOpen = await page.locator(".rl-back").count();
    if (!sheetOpen) {
      // To the very end (a long list can draw more as it's scrolled).
      for (let i = 0, h = -1; i < 12; i++) { const n = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return document.documentElement.scrollHeight; }); await settle(page, 350); if (n === h) break; h = n; }
      found.push(...await page.evaluate(UNDER_BAR));
      if (SHOTS) await page.screenshot({ path: join(SHOTS, cfg.name + "-" + name + "-bottom.png") });
      await page.evaluate(() => window.scrollTo(0, 0)); await settle(page, 150);
    }
  }
  for (const f of found) problems.push(cfg.name + " " + name + " | " + f);
  if (AUDIT) console.log((found.length ? "  " + found.length + " problems  " : "  ok  ") + cfg.name + " " + name + (found.length ? "\n    " + found.join("\n    ") : ""));
}
const unbig = (page) => page.evaluate(() => { for (const e of document.querySelectorAll("[data-big]")) { e.style.removeProperty("font-size"); e.style.removeProperty("line-height"); delete e.dataset.big; } });
const sheet = (page) => page.locator(".rl-back .rl-sheet").last();
async function closeAll(page) { for (let i = 0; i < 4 && await page.locator(".rl-back").count(); i++) { await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }).catch(() => {}); await settle(page, 350); } }
const tabTo = async (page, key) => { await unbig(page); await closeAll(page); await page.evaluate(k => window.go(k), key); await settle(page, 600); };

// Each screen: how to get to it, from wherever the last one left off.
const SCREENS = [];
const screen = (name, who, fn, o = {}) => SCREENS.push({ name, who, fn, ...o });

// Not signed in.
screen("welcome", "out", async (page, cfg) => { await page.locator("button:visible").first().waitFor(); await settle(page, 1200); await look(page, cfg, "welcome", { bar: false }); });
// A brand-new shopper.
screen("new-home", "new", async (page, cfg) => { await homeReady(page); await settle(page, 800); await look(page, cfg, "new-home"); });
screen("new-receipts", "new", async (page, cfg) => { await tabTo(page, "receipts"); await look(page, cfg, "new-receipts"); });
screen("new-browse", "new", async (page, cfg) => { await tabTo(page, "discover"); await look(page, cfg, "new-browse"); });
screen("new-watching", "new", async (page, cfg) => { await tabTo(page, "profile"); await homeReady(page); await page.locator("#view .h2-chip", { hasText: "Watching" }).click(); await look(page, cfg, "new-watching"); });
screen("new-bank", "new", async (page, cfg) => { await tabTo(page, "profile"); await tapPicture(page); await page.locator("#mePage .rl-arow:visible", { hasText: "Bank and cards" }).first().click(); await settle(page, 700); await look(page, cfg, "new-bank"); });
screen("new-inboxes", "new", async (page, cfg) => { await tabTo(page, "profile"); await tapPicture(page); await page.locator("#mePage .rl-arow:visible", { hasText: "Inboxes" }).first().click(); await settle(page, 700); await look(page, cfg, "new-inboxes"); });

// The full account.
const CHIPS = ["For you", "Watching", "To return", "On the way", "Swaps and returns"];
for (const c of CHIPS) screen("home-" + c.toLowerCase().replace(/\W+/g, "-"), "full", async (page, cfg) => {
  await homeReady(page); const chip = page.locator("#view .h2-chip", { hasText: c }).first();
  if (!(await chip.count())) { problems.push(cfg.name + " home chip missing: " + c); return; }
  await unbig(page); await waitOutDoubleTap(page); await chip.click(); await settle(page, 900); await look(page, cfg, "home-" + c.toLowerCase().replace(/\W+/g, "-"));
});
screen("ask", "full", async (page, cfg) => { await tabTo(page, "ask"); await look(page, cfg, "ask"); });
screen("browse", "full", async (page, cfg) => { await tabTo(page, "discover"); await settle(page, 800); await look(page, cfg, "browse"); });
screen("receipts", "full", async (page, cfg) => { await tabTo(page, "receipts"); await page.locator("#receiptsPage .rl-rr-row, #receiptsPage button").first().waitFor(); await settle(page, 800); await look(page, cfg, "receipts"); });
// Each kind of receipt's page, from the Receipts list.
const RECEIPT_PAGES = [["long-name", "Extraordinarily"], ["several-items", "Harlow"], ["on-its-way", "Northfold"], ["returning", "Kick Lane"], ["refunded", "Glow Lab"], ["cancelled", "Brindle"],
  ["supermarket", "Sainsbury"], ["takeaway", "Golden Lotus|Deliveroo"], ["game-coins", "Gold Coins|Pixel Forge"], ["subscription", "Apple"], ["hotel", "Harbour View"], ["flight", "Skyway"],
  ["gift-card", "Gift Card|Larkspur"], ["gift", "Tidepool"], ["euros", "Maison Verte"]];
for (const [n, t] of RECEIPT_PAGES) screen("receipt-" + n, "full", async (page, cfg) => {
  // On Receipts, a receipt opens underneath its line.
  await tabTo(page, "receipts"); await page.locator("#receiptsPage .rl-rr-main").first().waitFor();
  const row = page.locator("#receiptsPage .rl-rr-main").filter({ hasText: new RegExp(t) }).first();
  if (!(await row.count())) { problems.push(cfg.name + " receipt row missing: " + n); return; }
  // (One open at a time: any left open by the last look are closed first.)
  for (const open of await page.locator("#receiptsPage .rl-rr.open > .rl-rr-main").all()) { await waitOutDoubleTap(page); await open.click(); }
  await row.evaluate(e => e.scrollIntoView({ block: "start" })); await page.evaluate(() => window.scrollBy(0, -16)); await waitOutDoubleTap(page); await row.click(); await settle(page, 700);
  await row.evaluate(e => e.scrollIntoView({ block: "start" })); await page.evaluate(() => window.scrollBy(0, -16)); await settle(page, 200);
  await look(page, cfg, "receipt-" + n, { bar: false });
  // From Home (or Receipts' search when Home doesn't show it), its own page.
  await tabTo(page, "profile"); await homeReady(page);
  const sq = page.locator("#homePage .hl-sq, #homePage .h2-item").filter({ hasText: new RegExp(t) }).first();
  if (await sq.count()) { await sq.scrollIntoViewIfNeeded(); await waitOutDoubleTap(page); await sq.click(); await sheet(page).waitFor(); await settle(page, 600); await look(page, cfg, "receipt-" + n + "-page");
    await page.evaluate(() => { const s = [...document.querySelectorAll(".rl-back .rl-sheet")].pop(); if (s) s.scrollTop = s.scrollHeight; }); await settle(page, 300); await look(page, cfg, "receipt-" + n + "-page-end"); }
});
screen("receipts-filter", "full", async (page, cfg) => { await tabTo(page, "receipts"); await page.locator("#view .rl-calm-filter").first().click(); await sheet(page).waitFor(); await look(page, cfg, "receipts-filter"); });
screen("add-receipt", "full", async (page, cfg) => {
  await tabTo(page, "receipts"); const b = page.locator("#view .rl-calm-add").first();
  if (!(await b.count())) { problems.push(cfg.name + " no Add a receipt button on Receipts"); return; }
  await b.click(); await settle(page, 700); await look(page, cfg, "add-receipt");
});
// A receipt's own page from Home (the one that needs you), and what its buttons open.
screen("home-receipt-page", "full", async (page, cfg) => {
  await tabTo(page, "profile"); await homeReady(page); await page.locator("#view .h2-chip", { hasText: "For you" }).first().click(); await settle(page, 500);
  const card = page.locator("#homePage .h2-feed button, #homePage .h2-feed [role=button]").filter({ hasText: "Ultralight" }).first();
  await waitOutDoubleTap(page); await card.click(); await sheet(page).waitFor(); await settle(page, 600); await look(page, cfg, "home-receipt-page");
  await page.evaluate(() => { const s = [...document.querySelectorAll(".rl-back .rl-sheet")].pop(); if (s) s.scrollTop = s.scrollHeight; }); await settle(page, 300); await look(page, cfg, "home-receipt-page-end");
  const go = sheet(page).getByRole("button", { name: /sending this back|Start (a )?return|Return it/i }).first();
  if (await go.count()) { await waitOutDoubleTap(page); await go.click(); await settle(page, 900); await look(page, cfg, "return-flow"); }
  else problems.push(cfg.name + " home-receipt-page | no way to start a return on a receipt with 2 days left");
});
for (const [n, label] of [["fix-details", "Fix details"], ["view-receipt", "View receipt"], ["same-order", "Choose it"]]) screen("receipt-" + n, "full", async (page, cfg) => {
  await tabTo(page, "receipts"); await page.locator("#receiptsPage .rl-rr-main").first().waitFor();
  for (const open of await page.locator("#receiptsPage .rl-rr.open > .rl-rr-main").all()) { await waitOutDoubleTap(page); await open.click(); }
  const row = page.locator("#receiptsPage .rl-rr-main").filter({ hasText: "Harlow" }).first(); await waitOutDoubleTap(page); await row.click(); await settle(page, 500);
  await page.locator("#receiptsPage .rl-rr.open").getByRole("button", { name: label }).first().click(); await settle(page, 900); await look(page, cfg, "receipt-" + n);
});
screen("signin", "out", async (page, cfg) => {
  await tabTo(page, "profile"); await page.locator("button:visible", { hasText: "I already have an account" }).first().click(); await settle(page, 800); await look(page, cfg, "signin", { bar: false });
});
screen("returns", "full", async (page, cfg) => { await tabTo(page, "returns"); await settle(page, 700); await look(page, cfg, "returns"); });
screen("profile", "full", async (page, cfg) => { await tabTo(page, "profile"); await tapPicture(page); await settle(page, 700); await look(page, cfg, "profile"); });
for (const r of ["Inboxes", "Bank and cards"]) screen("profile-" + r.toLowerCase().replace(/\W+/g, "-"), "full", async (page, cfg) => {
  await tabTo(page, "profile"); await tapPicture(page); await page.locator("#mePage .rl-arow:visible", { hasText: r }).first().click(); await settle(page, 900); await look(page, cfg, "profile-" + r.toLowerCase().replace(/\W+/g, "-"));
});
screen("settings", "full", async (page, cfg) => { await tabTo(page, "profile"); await tapPicture(page); await openSettings(page); await settle(page, 600); await look(page, cfg, "settings"); });
screen("watching-page", "full", async (page, cfg) => { await tabTo(page, "radar"); await settle(page, 900); await look(page, cfg, "watching-page"); });
screen("watching-sheet", "full", async (page, cfg) => { await tabTo(page, "profile"); await homeReady(page); await page.locator("#view .h2-chip", { hasText: "Watching" }).click(); await page.locator("#homePage .wl-card").first().waitFor(); await waitOutDoubleTap(page); await page.locator("#homePage .wl-card").first().click(); await sheet(page).waitFor(); await look(page, cfg, "watching-sheet"); });
screen("wrapped", "full", async (page, cfg) => { await tabTo(page, "wrapped"); await settle(page, 1200); await look(page, cfg, "wrapped", { bar: false }); });
screen("health", "full", async (page, cfg) => {
  await tabTo(page, "profile"); await tapPicture(page); await openSettings(page);
  const row = page.locator("#mePage .rl-arow:visible", { hasText: "Relay health" }).first(); if (!(await row.count())) { problems.push(cfg.name + " no Relay health row"); return; }
  await row.click(); await settle(page, 1200); await look(page, cfg, "health", { testtools: true });
}, { search: "?testtools=1" });

// First, the checker itself: a page with each kind of problem on it must have each one found (so a pass means something).
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.setContent(`<body style="margin:0;font:16px sans-serif">
    <div style="display:flex;flex-direction:column"><button style="height:60px">First card</button><button style="height:60px;margin-top:-30px">Second card</button></div>
    <p style="font-size:11px">Tiny words here</p><button style="height:30px">Short</button>
    <div style="width:520px;background:#eee">Too wide</div>
    <b style="display:block;width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">£1,234.56 total</b>
    <p>Shop · Item · Date</p><p style="height:20px;margin:0">Over</p><p style="margin:-20px 0 0">Under</p>
    <span style="position:relative;display:block"><span style="position:absolute;left:4px;top:4px">£</span><input style="position:relative;width:100%;height:44px;background:#ddd;border:0"></span></body>`);
  const found = (await page.evaluate(CHECK, { scale: 1 })).join("\n");
  for (const k of ["box over box: First card / Second card", "text under 13px: Tiny words", "tappable under 44px: Short", "sideways scroll", "cut off: £1,234.56", "facts joined with dots", "text over text", "text covered: \"£\""])
    assert.ok(found.includes(k), "the checker finds " + k + ":\n" + found);
  await ctx.close(); console.log("ok - the checker finds overlapping boxes and text, covered text, tiny text, small taps, sideways scroll, cut-off prices and dotted facts"); }

for (const cfg of CONFIGS) {
  const groups = {};
  for (const s of SCREENS) if (!ONLY || ONLY.test(s.name)) (groups[s.who + (s.search || "")] ||= []).push(s);
  for (const list of Object.values(groups)) {
    const { ctx, page, errors } = await person(cfg, list[0].who, list[0].search || "");
    for (const s of list) {
      try { await s.fn(page, cfg); } catch (e) { problems.push(cfg.name + " " + s.name + " | could not open: " + String(e.message || e).split("\n")[0]); if (AUDIT) console.log("  FAILED to open " + cfg.name + " " + s.name + ": " + String(e.message || e).split("\n")[0]); }
    }
    // (The original email is shown in a sandboxed frame, which can't run anything, the test browser's own helpers included.)
    for (const e of errors) if (!/context is sandboxed/.test(e)) problems.push(cfg.name + " page error: " + e);
    await ctx.close();
  }
}
await browser.close(); server.close();
if (AUDIT) { for (const p of problems.filter(p => !/ \| (text|box|tappable|cut|sideways|off the|facts|raw|test wording|under the)/.test(p))) console.log("  " + p); console.log(problems.length + " problems"); process.exit(0); }
assert.deepEqual(problems, [], "what a person would notice on the screens:\n" + problems.join("\n"));
console.log("ok - every screen, at phone size, with bigger text and on a desktop: nothing overlapping, under the tab bar, sideways, tiny, too small to tap or cut off");
