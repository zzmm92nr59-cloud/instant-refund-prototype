// Browser test: Relay's team reviewing Swap & resell reports (Profile, Team, Review reports). Stubbed Relay server,
// made-up members and items. Checks: a listing reported from Browse shows the listing as members see it (never who listed
// or reported it); a reported conversation shows its messages; taking a listing down asks first and is sent once; every
// button is big enough to tap.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "ops.tester@example.com";
const LISTING = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", TALK = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const st = { reviews: [], reviewed: new Set() };
const reports = () => [
  { id: LISTING, kind: "listing", createdAt: Date.now() - 3600e3, reason: "Looks like a counterfeit", reporterRole: "member", reportedRole: "seller", reportsAgainstReported: 2, reportedAlreadyBlocked: false,
    canRemoveListing: true, messages: [], item: { title: "Silk Scarf", store: "Brindle & Co", status: "active", size: "M", condition: "good", note: "Barely worn", askPence: 2500, currency: "GBP" } },
  { id: TALK, kind: "conversation", createdAt: Date.now() - 7200e3, reason: "Asked for a bank transfer up front", reporterRole: "buyer", reportedRole: "seller", reportsAgainstReported: 1, reportedAlreadyBlocked: false,
    canRemoveListing: true, item: { title: "Linen Shirt", store: "Fennel", status: "matched" },
    messages: [{ from: "reporter", body: "Can I collect it?", createdAt: 1 }, { from: "reported member", body: "Bank transfer first please", createdAt: 2 }] }
].filter(r => !st.reviewed.has(r.id));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p === "/relay/my/admin/me") return j({ admin: true, openReports: reports().length });
  if (p === "/relay/my/admin/reports") return j({ reports: reports() });
  const x = /^\/relay\/my\/admin\/reports\/([0-9a-f-]{36})\/review$/.exec(p);
  if (x && m === "POST") { st.reviews.push([x[1], JSON.parse(req.postData() || "{}")]); await new Promise(ok => setTimeout(ok, 300)); st.reviewed.add(x[1]); return j({ ok: true }); }
  if (p === "/relay/my/admin/review-account") return j({ on: false });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Ops Tester", photo: null });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
await page.evaluate(() => window.go("me"));
await page.locator(".rl-arow", { hasText: "Review reports" }).click();
const sheet = page.locator("#mePage"); // the review screen opens in place of Profile
await sheet.getByText("Looks like a counterfeit").waitFor();

// 1. A listing reported from Browse: the listing as members see it, never who listed or reported it.
const listing = sheet.locator(".rl-order", { hasText: "Looks like a counterfeit" });
const text = await listing.innerText();
for (const s of ["Silk Scarf · Brindle & Co", "A member reported this listing. Reports against this seller: 2.", "Size M · Good · £25.00 · On sale", "Seller's note: “Barely worn”"]) assert.ok(text.includes(s), "shows: " + s);
assert.ok(!/@|ops\.tester/.test(text), "never an email address");
// 2. A reported conversation shows its messages.
const talk = sheet.locator(".rl-order", { hasText: "Asked for a bank transfer up front" });
assert.match(await talk.innerText(), /Reported by the buyer about the seller\.[\s\S]*reporter:\s+Can I collect it\?[\s\S]*reported member:\s+Bank transfer first please/);
console.log("ok - a reported listing shows as members see it; a reported conversation shows its messages; no names");

// 3. Every button is big enough to tap.
const small = await sheet.evaluate(n => [...n.querySelectorAll("button")].filter(b => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).map(b => b.innerText + " " + Math.round(b.getBoundingClientRect().height)));
assert.deepEqual(small, [], "buttons at least 44px tall");

// 4. Taking the listing down asks first, then is sent once.
await listing.getByRole("button", { name: "Take listing down" }).click();
await page.getByRole("alertdialog").getByText("Take this listing down?").waitFor();
await page.getByRole("alertdialog").getByRole("button", { name: "Yes, do it" }).dblclick();
await sheet.getByText("Done.").waitFor();
await page.waitForTimeout(600);
assert.deepEqual(st.reviews, [[LISTING, { outcome: "remove_listing" }]], "sent once");
assert.equal(await sheet.locator(".rl-order", { hasText: "Looks like a counterfeit" }).count(), 0, "gone from the list once reviewed");
console.log("ok - taking a listing down asks first and is sent once; buttons are big enough to tap");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS report review: listings reported from Browse and reported conversations, no names, asks first, once per tap");
await browser.close(); server.close();
