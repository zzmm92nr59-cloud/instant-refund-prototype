// Browser test: "Send this email to Relay". Stubbed Relay server, made-up shops, people and emails.
// Checks: the fix sheet offers it only for a receipt that came from an inbox; the sheet shows greyed outlines, then exactly
// what will be sent; it sends once for a double tap, with the note; it says what happened and the receipt then says it was
// sent and until when, with a way to delete it; a second look offers "Delete what you sent"; plain English when the email
// can't be read. Admins: "Emails shoppers sent" lists them, opens one beside what Relay read and what the shopper said, and
// deletes one. Everything passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, openReceiptKind } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "ops@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222", ID3 = "33333333-3333-4333-8333-333333333333";
const base = { status: "confirmed", kind: "receipt", currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, returns: null };
const receipts = [
  { ...base, id: ID1, gmailId: "m1abcdef", retailer: { name: "Brindle & Co", domain: "brindle.example" }, orderRef: "BR-1", orderDate: day(-5), totalPence: null,
    items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500, category: "fashion" }] },
  { ...base, id: ID2, pasted: true, retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-2", orderDate: day(-3), totalPence: 6000,
    items: [{ name: "Linen Shirt", qty: 1, pricePence: 6000, category: "fashion" }] },
  { ...base, id: ID3, gmailId: "m3abcdef", retailer: { name: "Fennel", domain: "fennel.example" }, orderRef: "FN-3", orderDate: day(-2), totalPence: 2500,
    items: [{ name: "Canvas Tote", qty: 1, pricePence: 2500, category: "fashion" }] }];
const st = { sent: null, posts: [], adminPosts: [], opened: 0, kept: true };
const sentAt = new Date().toISOString(), until = new Date(Date.now() + 30 * 864e5).toISOString();
const SHARED = { id: "99999999-9999-4999-8999-999999999999", sentAt, deletedBy: until, lookedAt: null, reader: 26, domain: "brindle.example", shop: "Brindle & Co",
  note: "The total was missed", read: { kind: "receipt", shop: "Brindle & Co", domain: "brindle.example", orderRef: "BR-1", orderDate: day(-5), totalPence: null, currency: "GBP", confidence: "low", reader: 26,
    items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500 }] }, fixed: { totalPence: 4500 } };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const sh = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/share$/.exec(p);
  if (sh && m === "GET") {
    await new Promise(ok => setTimeout(ok, 450)); // slow enough to see the outlines
    if (sh[1] === ID3) return j({ error: "email_not_found" }, 404);
    return j({ subject: "[name], your Brindle order BR-1", from: "Brindle & Co <[email]>", text: "Hi [name],\nThanks for your order BR-1.\nMerino Wool Scarf | £45.00\nTotal £45.00\nDelivery address\n[address]\nView your order: [link]",
      cut: false, hidden: { names: 2, emails: 1, addresses: 1, links: 1 }, keptDays: 30, sent: st.sent });
  }
  if (sh && m === "POST") {
    const b = JSON.parse(route.request().postData() || "{}"); st.posts.push([sh[1], b]);
    await new Promise(ok => setTimeout(ok, 350));
    if (b.delete) { st.sent = null; return j({ ok: true, deleted: true }); }
    st.sent = { at: sentAt, until }; return j({ ok: true, sent: st.sent });
  }
  if (p === "/relay/my/admin/me") return j({ admin: true, openReports: 0 });
  if (p === "/relay/my/admin/review-account") return j({ on: false });
  if (p === "/relay/my/admin/shared-emails" && m === "GET") { await new Promise(ok => setTimeout(ok, 300)); return j({ emails: st.kept ? [SHARED] : [], keptDays: 30 }); }
  if (p === "/relay/my/admin/shared-emails/" + SHARED.id) {
    if (m === "POST") { st.adminPosts.push(JSON.parse(route.request().postData() || "{}")); st.kept = false; return j({ ok: true }); }
    st.opened++; await new Promise(ok => setTimeout(ok, 300));
    return j({ ...SHARED, lookedAt: new Date().toISOString(), subject: "[name], your Brindle order BR-1", from: "Brindle & Co <[email]>",
      text: "Hi [name],\nThanks for your order BR-1.\nMerino Wool Scarf | £45.00\nTotal £45.00", hidden: {}, cut: false });
  }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: receipts.map(r => (r.id === ID1 && st.sent ? { ...r, shared: { ...st.sent, read: false } } : r)) });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Ops", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/2fa") return j({ app: false, text: false });
  if (p === "/relay/my/phone") return j({ available: true, ending: null });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules within one part of the page: 44px tap targets, 13px text (12px capitals), readable contrast, no symbol
// characters as icons, nothing wider than the screen.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " textarea")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
    await page.screenshot({ path: "/tmp/shots/share-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await openReceiptKind(page, "Fashion");
const fixSheet = page.getByRole("dialog", { name: "Fix this receipt" }), shareSheet = page.getByRole("dialog", { name: "Send this email to Relay" });

// 1. Only a receipt that came from an inbox can be sent: a pasted one can't.
const shirt = page.locator(".rl-rr").filter({ hasText: "Linen Shirt" });
await shirt.locator(".rl-rr-main").click();
await shirt.getByRole("button", { name: "Fix details" }).click();
await fixSheet.waitFor();
assert.equal(await fixSheet.getByRole("button", { name: "Send this email to Relay" }).count(), 0, "a pasted receipt has no email to send");
await fixSheet.getByRole("button", { name: "Cancel" }).click();
await fixSheet.waitFor({ state: "detached" });
console.log("ok - only receipts that came from an inbox offer it");

// 2. The scarf: from Fix details, see what will be sent (outlines first), add a note, send once.
const scarf = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await scarf.locator(".rl-rr-main").click();
await scarf.getByRole("button", { name: "Fix details" }).click();
await fixSheet.getByText("Too much to fix, or keeps coming out wrong?").waitFor();
await fixSheet.getByRole("button", { name: "Send this email to Relay" }).click();
await shareSheet.waitFor();
assert.equal(await fixSheet.count(), 0, "the fix sheet makes way");
await shareSheet.locator(".rl-share-box.rl-skel").waitFor();
assert.equal(await shareSheet.getByText(/Loading/).count(), 0, "no bare 'Loading…'");
assert.equal(await shareSheet.getByRole("button", { name: "Send to Relay" }).isDisabled(), true, "nothing can be sent before it's been seen");
assert.equal(await shareSheet.getByRole("button", { name: "Delete what you sent" }).isVisible(), false, "nothing to delete before it's been sent");
await shareSheet.getByText("[name], your Brindle order BR-1").waitFor();
const box = await shareSheet.getByRole("region", { name: "What will be sent" }).innerText();
for (const s of ["From Brindle & Co <[email]>", "Merino Wool Scarf | £45.00", "Delivery address\n[address]", "View your order: [link]"]) assert.ok(box.includes(s), "shows: " + s);
assert.ok((await shareSheet.innerText()).includes("Before it goes, Relay hides web links, email addresses, phone numbers, card numbers and codes, postcodes, addresses and your name."));
await polished("sheet", ".rl-fix");
await shareSheet.getByLabel("What's wrong? (optional)").fill("  The total   was missed ");
await shareSheet.getByRole("button", { name: "Send to Relay" }).dblclick();
await shareSheet.getByRole("heading", { name: "Sent to Relay" }).waitFor();
assert.deepEqual(st.posts, [[ID1, { note: "The total was missed" }]], "sent once for a double tap, with the note tidied");
assert.match(await shareSheet.innerText(), /It's deleted on \d{1,2} [A-Z][a-z]{2}, and you can delete it sooner from this receipt\./);
await shareSheet.getByRole("button", { name: "Done" }).click();
await shareSheet.waitFor({ state: "detached" });
const sentRow = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await sentRow.getByText(/^You sent this email to Relay\. It's deleted on \d{1,2} [A-Z][a-z]{2}\.$/).waitFor();
console.log("ok - outlines, then exactly what will be sent; sent once with the note; the sheet and the receipt say so");

// 3. A second look offers to delete it; deleting from the receipt asks first.
await sentRow.getByRole("button", { name: "Fix details" }).click();
await fixSheet.getByRole("button", { name: "Send this email to Relay" }).click();
await shareSheet.getByText(/You sent this on \d{1,2} [A-Z][a-z]{2}\. Sending it again replaces that copy\./).waitFor();
assert.equal(await shareSheet.getByRole("button", { name: "Send it again" }).count(), 1);
await shareSheet.getByRole("button", { name: "Cancel" }).click();
await sentRow.getByRole("button", { name: "Delete it" }).click();
await page.getByRole("alertdialog").getByText("Delete the copy of this email you sent to Relay?").waitFor();
await page.getByRole("alertdialog").getByRole("button", { name: "Delete it" }).click();
await page.getByText("Deleted. Relay no longer has a copy of that email.").waitFor();
assert.deepEqual(st.posts[1], [ID1, { delete: true }]);
await page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" }).getByText("Something read wrong?").waitFor();
assert.equal(await page.getByText(/You sent this email to Relay/).count(), 0);
console.log("ok - a second look offers to delete it; deleting from the receipt asks first");

// 4. An email that's gone from the inbox: said plainly, nothing to send.
const tote = page.locator(".rl-rr").filter({ hasText: "Canvas Tote" });
await tote.locator(".rl-rr-main").click();
await tote.getByRole("button", { name: "Fix details" }).click();
await fixSheet.getByRole("button", { name: "Send this email to Relay" }).click();
await shareSheet.getByText("That email is no longer in your inbox, so it can't be sent.").waitFor();
assert.equal(await shareSheet.getByRole("button", { name: "Send to Relay" }).isVisible(), false);
assert.ok(!/email_not_found|404/.test(await shareSheet.innerText()), "no error codes");
await shareSheet.getByRole("button", { name: "Cancel" }).click();
console.log("ok - plain English when the email can't be read");

// 5. Admins: Emails shoppers sent.
await page.evaluate(() => window.go("me"));
const view = page.locator("#mePage");
await view.locator(".rl-arow", { hasText: "Emails shoppers sent" }).click();
await view.locator(".rl-se .rl-skel").first().waitFor();
const item = view.locator(".rl-se-card").filter({ hasText: "Brindle & Co" });
await item.waitFor();
const t = await item.innerText();
for (const s of ["Read by version 26", "“The total was missed”", "Shopper fixed the total", "Read with low confidence"]) assert.ok(t.includes(s), "the list shows: " + s);
assert.equal(st.opened, 0, "listing them opens none");
await item.getByRole("button", { name: "Read it" }).click();
await item.getByText("Thanks for your order BR-1.", { exact: false }).waitFor();
const opened = await item.innerText();
for (const s of ["Total", "Not found", "Shopper says: £45.00", "Order number", "BR-1", "Merino Wool Scarf £45.00", "From Brindle & Co <[email]>"]) assert.ok(opened.includes(s), "opened shows: " + s);
assert.equal(st.opened, 1);
await polished("admin", "#mePage .rl-asub");
await item.getByRole("button", { name: "Close" }).click();
await item.getByRole("button", { name: "Delete" }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "Delete it" }).click();
await view.getByText("No emails yet. When a shopper sends one from a receipt Relay read wrong, it shows here for 30 days.").waitFor();
assert.deepEqual(st.adminPosts, [{ delete: true }]);
console.log("ok - admins: listed without opening, opened beside what Relay read and what the shopper said, deleted after asking");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS send this email to Relay UI: only inbox receipts, outlines then the exact copy, once, plain English, delete, admins' list (stubbed server)");
await browser.close(); server.close();
