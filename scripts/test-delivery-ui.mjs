// Browser test: delivery details, and Buy filling in a shop's checkout with them. Stubbed Relay server, made-up person,
// shop and product; nothing reaches a shop.
// Checks: Profile has a Delivery details tile; the form names what to fix in plain words, saves once, and the row shows
// the address; on a product from a shop's website, Buy opens a sheet saying what goes to the shop, Continue asks Relay once
// (a double tap too), then says what was filled in (only what the shop took) with the shop's checkout to open; without
// details it offers to add them first, or to go without; when the shop can't be asked, it says so and offers the shop's
// basket. The shared reviewer account has no Delivery details. Passes the polish rules in light and dark, at phone size.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com";
const CHECKED = new Date(Date.now() - 2 * 36e5).toISOString();
const web = [{ sku: "web:hollow-pine.test:72", product: "Wool Beanie", variation: "Navy", priceMinor: 2800, currency: "GBP", imageUrl: null, quantity: null, inStock: true,
  storeName: "Hollow Pine", shopDomain: "hollow-pine.test", productUrl: "https://hollow-pine.test/products/wool-beanie?variant=72", kind: "Hats", checkedAt: CHECKED, webShop: true }];
const st = { delivery: null, saves: [], checkouts: [], removes: 0, checkout: null, review: false, lookup: false, lookups: [] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(req.postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/my/delivery" && m === "GET") return j({ delivery: st.delivery, lookup: Boolean(st.lookup) });
  if (p === "/relay/my/address-lookup") {
    st.lookups.push(u.searchParams.get("postcode")); await new Promise(r => setTimeout(r, 150));
    if (u.searchParams.get("postcode") === "SW11 1AX") return j({ error: "postcode_not_found", suggestions: ["SW11 1AA"] }, 404);
    return j({ postcode: "SW11 1AA", addresses: [
      { label: "Flat 1, 12 High Street", line1: "12 High Street", line2: "Flat 1", town: "London", county: "London", postcode: "SW11 1AA" },
      { label: "Flat 2, 12 High Street", line1: "12 High Street", line2: "Flat 2", town: "London", county: "London", postcode: "SW11 1AA" },
      { label: "14 High Street", line1: "14 High Street", line2: null, town: "London", county: "London", postcode: "SW11 1AA" }] });
  }
  if (p === "/relay/my/delivery" && m === "POST") {
    const b = body(); st.saves.push(b); await new Promise(r => setTimeout(r, 150));
    if (!/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(b.postcode || "")) return j({ error: "bad_field", field: "postcode" }, 400);
    st.delivery = { ...b, postcode: b.postcode.toUpperCase().replace(/^(.+?)\s*(\d[A-Z]{2})$/, "$1 $2"), phone: b.phone ? "+44" + b.phone.replace(/\s/g, "").slice(1) : null, line2: b.line2 || null, county: b.county || null, updatedAt: new Date().toISOString() };
    return j({ delivery: st.delivery });
  }
  if (p === "/relay/my/delivery/remove") { st.removes++; st.delivery = null; return j({ delivery: null }); }
  if (p === "/relay/my/web-checkout") { st.checkouts.push(body()); await new Promise(r => setTimeout(r, 300)); const c = st.checkout || { status: 200, body: { url: "https://hollow-pine.test/checkouts/cn/abc", shop: "Hollow Pine", emailFilled: true, addressFilled: true } }; return j(c.body, c.status); }
  if (p === "/relay/shopify/catalogue") return j({ products: [], published: true, publishedStoreCount: 0 });
  if (p === "/relay/web-shops") return j({ products: web, shops: [], preview: true });
  if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile" || p === "/relay/me") return j({ email: EMAIL, name: "Jess Tester", photo: null, ...(st.review ? { review: true } : {}) });
  if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 1 });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
    await page.screenshot({ path: "/tmp/shots/delivery-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })); localStorage.setItem("relay-web-preview", "1"); }, EMAIL);
await page.reload();
await page.locator("#walletPage").waitFor();

// 1. Profile: Delivery details under Shopping, and the form.
await page.evaluate(() => window.go("me"));
const row = page.locator("#mePage .rl-ptile", { hasText: "Delivery details" });
await row.getByText("Add your address").waitFor();
assert.equal(await row.getAttribute("aria-label"), "Delivery details, Add your address", "a tile on Profile");
await row.click();
await page.getByRole("button", { name: "Back to Profile" }).waitFor();
const field = name => page.getByLabel(name, { exact: true });
await field("First name").waitFor();
assert.equal(await field("Postcode").getAttribute("autocomplete"), "postal-code", "the phone can fill it in from your contacts");
assert.equal(await field("Address").getAttribute("autocomplete"), "address-line1");
assert.equal(await field("Phone number for the courier (optional)").getAttribute("type"), "tel");
await polished("form", "#mePage");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByText("Type your first name.").waitFor();
assert.equal(await page.evaluate(() => document.activeElement.id), "rl-dl-firstName", "the field to fix is ready to type in");
assert.equal(st.saves.length, 0, "nothing sent until the required fields are there");
await field("First name").fill("Jess"); await field("Last name").fill("Tester"); await field("Address").fill("12 High Street");
await field("Town or city").fill("London"); await field("Postcode").fill("SW11"); await field("Phone number for the courier (optional)").fill("07700 900456");
await page.getByRole("button", { name: "Save", exact: true }).dblclick();
await page.getByText("That isn't a UK postcode. Type it like SW11 1AA.").waitFor();
assert.equal(st.saves.length, 1, "saved once for a double tap");
await field("Postcode").fill("sw11 1aa");
await page.getByRole("button", { name: "Save", exact: true }).click();
await row.getByText("SW11 1AA", { exact: true }).waitFor();
assert.deepEqual(st.saves[1], { firstName: "Jess", lastName: "Tester", line1: "12 High Street", line2: "", town: "London", county: "", postcode: "sw11 1aa", phone: "07700 900456" });
console.log("ok - Profile: a Delivery details tile; the form says what to fix, saves once, and the tile shows the postcode");

// 2. Buy on a product from a shop's website: what goes to the shop, then the checkout with it filled in.
await page.evaluate(() => window.go("discover"));
await page.getByRole("button", { name: /^Wool Beanie, / }).click();
const buy = page.locator("#buyOnSite");
await buy.waitFor();
assert.equal(await buy.evaluate(n => n.tagName), "BUTTON", "a button now, not a plain link");
assert.match(await page.locator("#watchNote").innerText(), /^Relay fills in your delivery details at Hollow Pine's checkout\. /);
await buy.click();
const sheet = page.locator(".rl-sheet");
await sheet.getByRole("heading", { name: "Buy at Hollow Pine" }).waitFor();
await sheet.getByText("Wool Beanie", { exact: true }).waitFor();
await sheet.getByText("Navy, £28.00").waitFor();
assert.match(await sheet.locator(".rl-dl-to").innerText(), /Deliver to\s+Jess Tester\s+12 High Street\s+London\s+SW11 1AA\s+Email\s+jess\.tester@example\.com\s+Phone\s+07700 900456/);
await sheet.getByText("Relay fills these in at Hollow Pine's checkout. You choose delivery and pay there, not through Relay.").waitFor();
await polished("buy", ".rl-sheet");
await sheet.getByRole("button", { name: "Continue to Hollow Pine" }).dblclick();
await sheet.getByRole("heading", { name: "Ready at Hollow Pine" }).waitFor();
assert.equal(st.checkouts.length, 1, "asked once for a double tap");
assert.deepEqual(st.checkouts[0], { sku: "web:hollow-pine.test:72" });
assert.deepEqual(await sheet.locator(".rl-dl-tick").allInnerTexts(), ["Wool Beanie is in your basket", "Your email is filled in", "Your delivery address is filled in"]);
const openLink = sheet.getByRole("link", { name: "Open Hollow Pine's checkout" });
assert.equal(await openLink.getAttribute("href"), "https://hollow-pine.test/checkouts/cn/abc");
assert.equal(await openLink.getAttribute("target"), "_blank");
assert.equal(await sheet.locator(".rl-dl-tick svg").count(), 3, "drawn ticks, not symbols");
await polished("ready", ".rl-sheet");
await sheet.getByRole("button", { name: "Not now" }).click();
console.log("ok - Buy says what goes to the shop, asks Relay once, then says what was filled in and opens the shop's checkout");

// 3. The shop didn't take the address: said plainly.
st.checkout = { status: 200, body: { url: "https://hollow-pine.test/checkouts/cn/def", shop: "Hollow Pine", emailFilled: true, addressFilled: false } };
await buy.click();
await sheet.getByRole("button", { name: "Continue to Hollow Pine" }).click();
await sheet.getByText("Hollow Pine's checkout didn't take your address, so type it there").waitFor();
await sheet.getByRole("button", { name: "Not now" }).click();
// The shop couldn't be asked: plain words, and its basket instead.
st.checkout = { status: 502, body: { error: "shop_checkout_failed" } };
await buy.click();
await sheet.getByRole("button", { name: "Continue to Hollow Pine" }).click();
await sheet.getByText("Couldn't fill in Hollow Pine's checkout just now. You can still buy it there and type your details.").waitFor();
assert.equal(await sheet.getByRole("link", { name: "Go to Hollow Pine" }).getAttribute("href"), "https://hollow-pine.test/cart/72:1");
await sheet.getByRole("button", { name: "Cancel" }).click();
console.log("ok - when the shop doesn't take the address it says so; when the shop can't be asked, plain words and its basket");

// 4. Without delivery details: add them first, or go without.
await page.evaluate(() => window.go("me"));
await row.click();
await page.getByRole("button", { name: "Remove my delivery details" }).click();
await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
await row.getByText("Add your address").waitFor();
assert.equal(st.removes, 1);
await page.evaluate(() => window.go("discover"));
await page.getByRole("button", { name: /^Wool Beanie, / }).click();
st.checkout = null;
await page.locator("#buyOnSite").click();
await sheet.getByText("Add your delivery details once, and Relay fills them in at shops' checkouts for you.").waitFor();
assert.equal(await sheet.getByRole("link", { name: "Go to Hollow Pine without filling in" }).getAttribute("href"), "https://hollow-pine.test/cart/72:1");
await sheet.getByRole("button", { name: "Add delivery details" }).click();
await field("First name").fill("Jess"); await field("Last name").fill("Tester"); await field("Address").fill("12 High Street");
await field("Town or city").fill("London"); await field("Postcode").fill("SW11 1AA");
await sheet.getByRole("button", { name: "Save and continue" }).click();
await sheet.getByRole("button", { name: "Continue to Hollow Pine" }).waitFor();
assert.ok(!/Phone/.test(await sheet.locator(".rl-dl-to").innerText()), "no phone line without a phone number");
await polished("buy after adding", ".rl-sheet");
await sheet.getByRole("button", { name: "Cancel" }).click();
console.log("ok - without delivery details, Buy offers to add them first (then carries on) or to go without");

// 5. Find address: type the postcode, pick from the addresses there, and the rest is filled in.
assert.equal(await page.getByRole("button", { name: "Find address" }).count(), 0, "no Find address while Relay's postcode lookup is off");
st.lookup = true;
await page.evaluate(() => window.go("discover")); await page.evaluate(() => window.go("me"));
await row.click();
const find = page.getByRole("button", { name: "Find address" });
await find.waitFor();
assert.deepEqual(await page.locator("#mePage label.rl-jlabel").allTextContents(), ["First name", "Last name", "Postcode", "Address", "Flat, floor or building (optional)",
  "Town or city", "County (optional)", "Phone number for the courier (optional)"], "the postcode comes first, so it can fill in the rest");
assert.equal(await field("Postcode").getAttribute("autocomplete"), "postal-code", "and the phone's own AutoFill still fills every field");
await field("Postcode").fill("sw11 1ax");
await find.click();
await page.getByText("Couldn't find SW11 1AX. Did you mean one of these?").waitFor();
await page.getByRole("button", { name: "SW11 1AA", exact: true }).click();
const pick = page.getByRole("group", { name: "Addresses at SW11 1AA" });
await pick.waitFor();
assert.deepEqual(await pick.getByRole("button").allTextContents(), ["Flat 1, 12 High Street", "Flat 2, 12 High Street", "14 High Street"]);
await polished("find address", "#mePage");
await pick.getByRole("button", { name: "Flat 2, 12 High Street" }).click();
await page.getByText("Filled in. Check it, then save.").waitFor();
assert.deepEqual(await Promise.all(["Address", "Flat, floor or building (optional)", "Town or city", "County (optional)", "Postcode"].map(n => field(n).inputValue())),
  ["12 High Street", "Flat 2", "London", "London", "SW11 1AA"]);
assert.deepEqual(st.lookups, ["SW11 1AX", "SW11 1AA"], "one lookup per tap");
await page.getByRole("button", { name: "Save", exact: true }).click();
await row.getByText("SW11 1AA", { exact: true }).waitFor();
assert.equal(st.saves.at(-1).line2, "Flat 2");
// A postcode that can't be right isn't looked up at all.
await row.click();
await field("Postcode").fill("SW11");
await page.getByRole("button", { name: "Find address" }).click();
await page.getByText("Type the whole postcode, like SW11 1AA.").waitFor();
assert.equal(st.lookups.length, 2);
console.log("ok - Find address: the postcode first, a list of the addresses there, one tap fills the rest in; a wrong postcode says so");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS delivery details and Buy filling in the shop's checkout");
await browser.close(); server.close();
