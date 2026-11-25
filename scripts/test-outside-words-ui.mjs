// Browser test: words that come from outside Relay are always shown as words, never run as a web page's code.
// A shop's name, a thing's name, its size, an order number, a return's wording, the shopper's own name, an email's subject
// and a shop's return link all reach the app from emails and shops, so someone could put a web page's code in them.
// Here every one of them carries code that would set a flag if it ran. The app is then walked as a shopper would (Home,
// an order's page, Receipts, Returns & swaps, Profile and its edit page, Wrapped) and the flag must never be set, no
// element made from those words may exist, and the words must still be readable as written.
// Also what a shopper is told when signing in with Google is cancelled or fails, and when a sign-in link is no good.
// (These checks used to live in scripts/test-account-ui.mjs, written for the old account sheet, which no longer runs.)
// Stubbed Relay server, made-up account.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady, closeSheet, picture, tapPicture } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

// Code that sets a flag if it ever runs, one flag per place it was put.
const bad = (flag) => "<img src=x onerror=window.__ran_" + flag + "=1>";
const FLAGS = ["shop", "item", "size", "ref", "step", "name", "subject", "wshop", "witem", "link"];
const EMAIL = "pat.tester@example.com";
const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10), year = new Date().getFullYear();
const order = { id: "11111111-1111-4111-8111-111111111111", kind: "receipt", status: "confirmed", source: "gmail", gmailId: "m000000001", retailer: { name: bad("shop") + "Northwind", domain: "northwind.example" },
  orderRef: bad("ref") + "NW-1", subject: bad("subject") + "Your order", orderDate: today, totalPence: 10700, currency: "GBP", category: "fashion", returnable: true,
  items: [{ name: bad("item") + "Flared Pant", variant: bad("size") + "UK 8", pricePence: 6900, qty: 1 }, { name: "Cropped Tee", variant: "M", pricePence: 3800, qty: 1 }],
  returnBy: { date: soon }, returns: { portalUrl: "javascript:window.__ran_link=1", windowDays: 28, deadline: soon, instructions: [bad("step") + "Pack it in the bag it came in"] } };
// A return in progress Relay can't place, so Returns & swaps asks which things went back.
const other = { id: "22222222-2222-4222-8222-222222222222", kind: "receipt", status: "confirmed", retailer: { name: bad("shop") + "Fieldhouse", domain: "fieldhouse.example" }, orderDate: today, totalPence: 9000, currency: "GBP", category: "fashion",
  items: [{ name: bad("item") + "Rain Jacket", pricePence: 6000 }, { name: "Cap", pricePence: 3000 }], returnBy: { date: soon }, returnProgress: { parcel: { status: "in_transit" } } };
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wrapped = { year, years: [{ year, receipts: 2 }], receipts: 2, shops: 2, items: 4, spentPence: 19700, currency: "GBP", topItem: { name: bad("witem") + "Flared Pant", times: 2, shop: "Northwind" },
  coverage: { withTotal: 2, noTotal: 0, otherCurrency: 0 }, topShops: [{ name: bad("wshop") + "Northwind", receipts: 1, spentPence: 10700 }], categories: [{ category: "fashion", label: "Fashion", receipts: 2 }],
  byMonth: months.map((m, i) => ({ month: m, receipts: i === 2 ? 2 : 0, spentPence: 0 })), busiestMonth: "Mar", biggest: { shop: bad("wshop") + "Northwind", totalPence: 10700, date: today } };

const browser = await chromium.launch();
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route("https://**/*", route => {
    const u = new URL(route.request().url()), m = route.request().method();
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(b) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (!u.pathname.startsWith("/relay/")) return route.abort();
    if (u.pathname === "/relay/auth/verify") return j({ error: "invalid_or_expired_link" }, 400);
    if (u.pathname === "/relay/my/profile") return j({ email: EMAIL, name: bad("name") + "Pat", photo: null, updatedAt: null });
    if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (u.pathname === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
    if (u.pathname === "/relay/my/receipts") return j({ receipts: [order, other] });
    if (u.pathname === "/relay/my/purchases") return j({ purchases: [] });
    if (u.pathname === "/relay/my/wrapped") return j(wrapped);
    return j({});
  });
  return ctx;
}
// Nothing ran, and nothing was built out of the words: checked after every screen.
async function safe(page, where) {
  const got = await page.evaluate((flags) => ({ ran: flags.filter(f => window["__ran_" + f] !== undefined), made: document.querySelectorAll('img[src="x"], [onerror], a[href^="javascript:" i]').length }), FLAGS);
  assert.deepEqual(got.ran, [], where + ": words from outside never run as code");
  assert.equal(got.made, 0, where + ": and nothing on the page is built from them");
}
const words = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ");

{
  const ctx = await newContext(); await skipInterests(ctx);
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", () => { throw new Error("a browser pop-up appeared"); });
  await page.addInitScript((e) => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.goto(origin + "/index.html");
  // Home: the order's card, with the shop's name as written.
  await homeReady(page);
  await page.locator("#view .h2-feed", { hasText: "Northwind" }).first().waitFor();
  assert.ok((await words(page, "#view")).includes(bad("shop") + "Northwind"), "Home shows the shop's name exactly as it was written");
  await safe(page, "Home");
  // The order's page: the things, sizes, order number, return wording, and the shop's own return link.
  await page.locator("#view .h2-feed .hl-grid > *", { hasText: "Northwind" }).first().click();
  const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor();
  await sheet.getByText("Cropped Tee").first().waitFor();
  const onSheet = (await sheet.innerText()).replace(/\s+/g, " ");
  for (const [what, text] of [["the thing's name", bad("item") + "Flared Pant"], ["its size", bad("size") + "UK 8"]]) assert.ok(onSheet.includes(text), "the order's page shows " + what + " as written");
  await safe(page, "an order's page");
  // A shop's return link that isn't a web address is never offered as one to tap.
  assert.equal(await sheet.getByRole("button", { name: "Start return" }).count() + await sheet.getByRole("link", { name: /return/i }).count(), 0, "no way to open a return link that isn't a web address");
  await closeSheet(page);
  // Receipts: the list, and a search for the shop.
  await page.evaluate(() => window.go("receipts"));
  await page.locator("#receiptsPage").getByText("Northwind").first().waitFor();
  assert.ok((await words(page, "#receiptsPage")).includes(bad("shop") + "Northwind"), "Receipts shows the shop's name as written");
  await safe(page, "Receipts");
  // Returns & swaps: the question about which things went back names them as written.
  await page.evaluate(() => window.go("returns"));
  await page.locator("#returnsPage").getByText("Which items did you send back?").waitFor();
  assert.ok((await words(page, "#returnsPage")).includes(bad("item") + "Rain Jacket"), "Returns & swaps names the thing as written");
  await safe(page, "Returns & swaps");
  // Profile and its edit page: the shopper's own name. (Relay's server refuses a name like this; the app must not rely on that.)
  await page.evaluate(() => window.go("profile"));
  await homeReady(page);
  await picture(page).waitFor();
  await tapPicture(page);
  await page.locator("#mePage .rl-ahead b").waitFor();
  assert.equal(await page.locator("#mePage .rl-ahead b").textContent(), bad("name") + "Pat", "Profile shows the name as written");
  await safe(page, "Profile");
  await page.getByRole("button", { name: "Edit your name and photo" }).click();
  await page.locator("#mePage .rl-abar-t", { hasText: "Your profile" }).waitFor();
  assert.equal(await page.getByLabel("Your name").inputValue(), bad("name") + "Pat");
  await safe(page, "Your profile");
  // Wrapped: its cover, then every slide of the story.
  await page.evaluate(() => window.go("wrapped"));
  await page.getByRole("button", { name: "Play your " + year + " story" }).click();
  const slides = [];
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(700);
    slides.push(await words(page, ".rl-story-body"));
    await safe(page, "Wrapped, slide " + (k + 1));
    if (await page.getByRole("button", { name: "Watch again" }).count()) break;
    await page.keyboard.press("ArrowRight");
  }
  assert.ok(slides.join(" ").includes(bad("wshop") + "Northwind"), "Wrapped names the shop as written");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
  console.log("ok - shop names, item names, sizes, order numbers, return wording, the shopper's name and a return link that isn't a web address are shown as words on Home, an order's page, Receipts, Returns & swaps, Profile and Wrapped");
}

// Signing in with Google or Microsoft cancelled or failed, and a sign-in link that's no good: said plainly, with a way on.
{
  const ctx = await newContext();
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  for (const [hash, title, next] of [["gsignin=denied", "Google sign-in cancelled", "No problem. You can try again or use an email link instead."],
    ["gsignin=failed", "Google sign-in didn't work", "Please try again, or use an email link instead."],
    ["msignin=denied", "Microsoft sign-in cancelled", "No problem. You can try again or use an email link instead."],
    ["msignin=other_address", "Microsoft sign-in didn't work", "Microsoft sign-in works with Outlook, Hotmail and Live addresses. For any other address, use the email link or code instead."]]) {
    await page.goto("about:blank"); await page.goto(origin + "/index.html#" + hash);
    await page.getByRole("heading", { name: title }).waitFor();
    await page.getByText(next, { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Back to sign in" }).count(), 1, title + ": a way back to signing in");
    assert.equal(await page.evaluate(() => location.hash), "", "and the note leaves the address bar");
    assert.equal(await page.evaluate(() => localStorage.getItem("relay.session.v1")), null, "not signed in");
  }
  // A link that's wrong or has run out, opened in the browser that asked for it (it holds the secret from the start).
  await page.goto(origin + "/index.html");
  await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
  await page.goto("about:blank"); await page.goto(origin + "/index.html#signin=" + "X".repeat(43));
  await page.getByRole("heading", { name: "Sign-in failed" }).waitFor();
  const told = (await page.locator(".rl-sheet").last().innerText()).replace(/\s+/g, " ");
  assert.ok(!/invalid_or_expired_link|Something went wrong|undefined|\{|\}/.test(told), "said in plain English, never the server's own code: " + told);
  assert.equal(await page.getByRole("button", { name: "Try again" }).count(), 1, "with a way to try again");
  assert.equal(await page.evaluate(() => localStorage.getItem("relay.session.v1")), null, "not signed in");
  assert.ok(!(await page.evaluate(() => location.href)).includes("X".repeat(43)), "the link's secret leaves the address bar");
  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
  console.log("ok - Google or Microsoft sign-in cancelled or failed, and a sign-in link that's no good, are said plainly with a way on");
}

await browser.close(); server.close();
console.log("PASS words from outside: always shown as words, never run; sign-in problems said plainly");
