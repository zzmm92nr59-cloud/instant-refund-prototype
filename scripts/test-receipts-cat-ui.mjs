// Browser test: a receipt group's page. Stubbed Relay server, made-up account with 130 food receipts over two years plus
// a fashion order with a return deadline ahead. Checks: the Receipts page asks for every receipt (not just 100); the
// group's header says how many, how much and since when; filters for "Can still return" and each year; receipts are
// in months, newest first, with each month's total; 40 at a time with "Show more"; a whole row opens its details;
// search works; everything passes the polish rules (44px taps, no tiny text, no symbol icons).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".ico" ? "image/x-icon" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@gmail.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const food = Array.from({ length: 130 }, (_, i) => ({ id: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"), status: "confirmed", kind: "receipt",
  retailer: { name: i % 2 ? "Deliveroo" : "Greggs", domain: i % 2 ? "deliveroo.co.uk" : "greggs.co.uk" }, orderRef: "F" + (1000 + i), orderDate: day(-i * 5), totalPence: 1000 + i, currency: "GBP",
  items: [{ name: i === 7 ? "Sausage roll" : "Meal " + i, qty: 1 }], category: "food", categoryLabel: "Food & drink", returnable: false, notReturnableReason: "Food and drink usually can't be returned." }));
const fashion = [{ id: "99999999-9999-4999-8999-999999999999", status: "confirmed", kind: "receipt", retailer: { name: "RAINS", domain: "rains.com" }, orderRef: "RA-1", orderDate: day(-5), totalPence: 9500, currency: "GBP",
  items: [{ name: "Long Jacket", qty: 1, pricePence: 9500 }], category: "fashion", categoryLabel: "Fashion", returnable: true, returns: { deadline: day(20) } },
  { id: "88888888-8888-4888-8888-888888888888", status: "confirmed", kind: "receipt", retailer: { name: "RAINS", domain: "rains.com" }, orderRef: "RA-0", orderDate: day(-400), totalPence: 4500, currency: "GBP",
  items: [{ name: "Bucket Hat", qty: 1, pricePence: 4500 }], category: "fashion", categoryLabel: "Fashion", returnable: true, returns: { deadline: day(-370) } }];
const asked = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() });
  if (p === "/relay/my/receipts") { asked.push(u.search); return j({ receipts: u.searchParams.get("all") === "1" ? [...fashion, ...food] : [...fashion, ...food].slice(0, 100) }); }
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const measure = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out = { small: [], tiny: [] };
  for (const el of document.querySelectorAll("#view button, #view input, #view select")) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.height < 43.5) out.small.push((el.innerText || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height)); }
  for (const el of document.querySelectorAll("#view *")) { if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; if (parseFloat(getComputedStyle(el).fontSize) < 12) out.tiny.push(el.textContent.trim().slice(0, 30)); }
  return out;
});
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
await page.evaluate(() => window.go("receipts"));
await page.getByRole("button", { name: "Food & drink, 130 receipts" }).waitFor();
assert.ok(asked.includes("?all=1"), "the Receipts page asks for every receipt: " + asked.join(","));
console.log("ok - the Receipts page gets all 130, not just the newest 100");

// Food & drink: 130 receipts over two years.
await page.getByRole("button", { name: "Food & drink, 130 receipts" }).click();
const hero = page.locator(".rl-cat-hero");
await hero.waitFor();
const spent = food.reduce((n, r) => n + r.totalPence, 0);
assert.match(await hero.innerText(), new RegExp("130 receipts · £" + (spent / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 }).replace(/[.]/g, "\\.") + " spent · since "));
const chipNames = await page.locator(".rl-cat-chips button").allInnerTexts();
assert.equal(chipNames[0], "All"); assert.ok(chipNames.length >= 3, "a filter for each year: " + chipNames);
assert.ok(!chipNames.includes("Can still return"), "no 'can still return' filter where nothing can go back");
const months = page.locator(".rl-cat-month"); await months.first().waitFor();
assert.ok(await months.count() >= 4, "receipts are in months");
const first = await months.first().innerText();
assert.match(first, new RegExp(new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })), "newest month first: " + first);
assert.match(first, /receipts? · £/, "with the month's total");
assert.equal(await page.locator(".rl-rr").count(), 40, "40 at a time");
await page.getByRole("button", { name: /^Show 40 more of 90$/ }).click();
assert.equal(await page.locator(".rl-rr").count(), 80);
const m = await measure(); assert.deepEqual(m, { small: [], tiny: [] }, "polish rules on the group page");
await page.screenshot({ path: "/tmp/shots/cat-food.png" });
// A whole row opens its details.
const row = page.locator(".rl-rr").filter({ hasText: "Sausage roll" });
await row.locator(".rl-rr-main").click();
assert.equal(await row.locator(".rl-rr-main").getAttribute("aria-expanded"), "true");
await row.locator("select").waitFor();
await page.waitForTimeout(500); // a second tap straight after the first is ignored on purpose (no double taps)
await row.locator(".rl-rr-main").click();
assert.equal(await row.locator(".rl-rr-detail").count(), 0);
// Year filter and search.
const lastYear = String(new Date().getFullYear() - 1);
await page.locator(".rl-cat-chips button", { hasText: lastYear }).click();
assert.ok(!(await page.locator(".rl-cat-month").allInnerTexts()).some(t => !t.includes(lastYear)), "only that year");
await page.locator(".rl-cat-chips button", { hasText: "All" }).click();
await page.locator(".rl-cat-search").fill("sausage");
assert.equal(await page.locator(".rl-rr").count(), 1);
await page.locator(".rl-cat-search").fill("zzzz");
await page.getByText("Nothing matches that search").waitFor();
console.log("ok - a group's page: header with count, spend and since when; years; months with totals; 40 at a time; rows open; search");

// Fashion: "Can still return" shows only what can still go back, with its days left.
await page.getByRole("button", { name: "All groups" }).click();
await page.getByRole("button", { name: /^Fashion, 2 receipts$/ }).click();
await page.locator(".rl-cat-chips button", { hasText: "Can still return" }).click();
assert.equal(await page.locator(".rl-rr").count(), 1);
assert.match(await page.locator(".rl-rr").innerText(), /Long Jacket[\s\S]*£95\.00[\s\S]*20 days left/);
await page.screenshot({ path: "/tmp/shots/cat-fashion.png" });
console.log("ok - 'Can still return' shows what can still go back, with the days left");
// Home only shows what can still go back: never supermarket or takeaway food, even when the email mentions a deadline.
food[0].returns = { deadline: day(10) };
await page.evaluate(() => window.go("profile"));
const wallet = page.locator("#walletPage");
await wallet.getByText("Long Jacket").first().waitFor();
const homeText = await wallet.innerText();
assert.ok(!/Greggs|Deliveroo|Sausage roll|Meal \d/.test(homeText), "no food on Home: " + homeText.slice(0, 200));
assert.ok(!/Bucket Hat/.test(homeText), "nothing past its return date");
console.log("ok - Home shows only what can still be returned");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS receipt groups: every receipt, a clear header, filters, months with totals, tidy rows");
await browser.close(); server.close();
