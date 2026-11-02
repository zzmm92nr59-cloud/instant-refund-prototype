// Browser test: scans that carry on after the shopper leaves. Stubbed Relay server, made-up account.
// Checks: opening Receipts while Relay is still reading shows how far it has got and carries on; when Relay is busy with
// the rounds itself the app waits and shows progress; leaving the page stops the app asking (Relay carries on); and a
// scan that finished while the shopper was away is mentioned once.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@outlook.com";
// The scan as Relay sees it.
const state = { job: { state: "running", full: false, found: 5, scannedBack: "2026-03-01", startedAt: Date.now() - 60000, updatedAt: Date.now(), finishedAt: null, error: null }, busyLeft: 1, roundsLeft: 2, posts: 0 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (u.pathname === "/relay/my/gmail" && m === "GET") return j({ connected: true, provider: "microsoft", email: EMAIL, googleEmail: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: null, scan: state.job });
  if (u.pathname === "/relay/my/gmail/scan") {
    state.posts++;
    if (state.busyLeft > 0) { state.busyLeft--; return j({ ok: true, busy: true, added: 0, updated: 0, more: true, retryAfterMs: 300, job: state.job }); }
    if (state.roundsLeft > 0) {
      state.roundsLeft--;
      state.job = { ...state.job, found: state.job.found + 10, scannedBack: state.roundsLeft ? "2025-12-01" : "2025-08-01" };
      if (!state.roundsLeft) state.job = { ...state.job, state: "done", finishedAt: Date.now() };
      return j({ ok: true, added: 10, updated: 0, more: state.job.state === "running", job: state.job });
    }
    return j({ ok: true, added: 0, updated: 0, more: false, job: state.job });
  }
  if (u.pathname === "/relay/my/receipts") return j({ receipts: [] });
  if (u.pathname === "/relay/my/purchases") return j({ purchases: [] });
  if (u.pathname === "/relay/my/profile") return j({ email: EMAIL, name: null, photo: null });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload(); await page.waitForTimeout(400);

// 1. Relay is still reading: the Receipts page shows how far it has got, waits while Relay is busy, then carries on to the end.
await page.evaluate(() => window.go("receipts"));
await page.getByText(/Reading back to March 2026… 5 found so far\. You can close Relay, it carries on\./).waitFor();
await page.screenshot({ path: "/tmp/shots/scan-background.png" });
await page.getByText(/Found or updated 25 receipt or return emails/).waitFor({ timeout: 8000 });
assert.equal(state.posts, 3, "one wait while Relay was busy, then two rounds");
console.log("ok - opening Receipts mid-scan shows the progress, waits while Relay is busy, and finishes");

// 2. A scan that finished while the shopper was away is mentioned once.
state.job = { ...state.job, state: "done", found: 42, finishedAt: Date.now() - 60000 };
await page.evaluate(() => localStorage.removeItem("relay.scanSeen"));
await page.reload(); await page.waitForTimeout(300);
await page.evaluate(() => window.go("receipts"));
await page.getByText("Finished reading your Outlook while you were away: 42 found.").waitFor();
await page.reload(); await page.waitForTimeout(300);
await page.evaluate(() => window.go("receipts"));
await page.waitForTimeout(800);
assert.equal(await page.getByText("while you were away").count(), 0, "only mentioned once");
console.log("ok - a scan that finished while the shopper was away is mentioned once");

// 3. Leaving the page mid-scan: the app stops asking (Relay carries on by itself).
state.job = { ...state.job, state: "running", found: 7, finishedAt: null }; state.busyLeft = 50; state.posts = 0;
await page.reload(); await page.waitForTimeout(300);
await page.evaluate(() => window.go("receipts"));
await page.getByText(/7 found so far/).waitFor();
await page.evaluate(() => window.go("wrapped"));
const asked = state.posts;
await page.waitForTimeout(1200);
assert.ok(state.posts <= asked + 1, "the app stopped asking once the page was left: " + (state.posts - asked));
console.log("ok - leaving the page stops the app asking; Relay carries on by itself");

assert.deepEqual(errors, [], "no page errors");
await browser.close(); server.close();
