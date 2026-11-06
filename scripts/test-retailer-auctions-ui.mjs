// Browser test: auctions in the shop's dashboard (retailer.html), against a stand-in Relay server. Made-up shop and items.
// Checks: a Shopify shop sees Auctions with its own auctions and what happened to each, in words, with links to its own
// orders; starting one from the catalogue (search, pick, condition, starting bid, delivery, how long, the promise not to
// bid) sends exactly that, once; a one-off needs a photo, which is made smaller on the device first; plain words for every
// refusal; an auction nobody has bid on can be cancelled; without Shopify's permission to create orders the shop is told
// how to give it; Square shops don't see auctions.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const now = Date.now(), day = 864e5;
const conditions = { new_tags: "New with tags", new: "New without tags", returned: "Returned, unworn", sample: "Sample", worn_good: "Worn, good condition", worn_marks: "Worn, small marks" };
const view = (o) => ({ id: o.id, shop: "Hollow Pine", title: "Wool Beanie", variant: "Navy", size: null, condition: "new_tags", conditionText: "New with tags", fromCatalogue: true,
  pictures: ["https://cdn.shop.test/71.jpg"], startMinor: 1000, priceMinor: null, nextMinor: 1000, bids: 0, deliveryMinor: 395, currency: "GBP", endsAt: now + day, status: "live", outcome: null, offers: [], ...o });
const st = {
  platform: "shopify", canOrder: true, posts: [],
  auctions: [
    view({ id: "a1111111-1111-4111-8111-111111111111", priceMinor: 3100, bids: 4 }),
    view({ id: "a2222222-2222-4222-8222-222222222222" }),
    view({ id: "a3333333-3333-4333-8333-333333333333", title: "Field Tee", variant: null, status: "ended", priceMinor: 7200, bids: 6, outcome: "sold",
      offers: [{ rank: 1, priceMinor: 7200, status: "paid", payBy: now - day, orderName: "#9001", orderUrl: "https://admin.shopify.com/store/hollow-pine/orders/9001" }] }),
    view({ id: "a4444444-4444-4444-8444-444444444444", title: "Rain Shell", variant: "M", status: "ended", priceMinor: 6100, bids: 3, outcome: "awaiting_payment",
      offers: [{ rank: 1, priceMinor: 7000, status: "expired", payBy: now - 3600e3, orderName: "#9002", orderUrl: null },
        { rank: 2, priceMinor: 6100, status: "awaiting_payment", payBy: now + 20 * 3600e3, orderName: "#9003", orderUrl: "https://admin.shopify.com/store/hollow-pine/orders/9003" }] }),
    view({ id: "a5555555-5555-4555-8555-555555555555", title: "Old Scarf", variant: null, status: "ended", outcome: "no_bids" })
  ],
  items: [{ variantKey: "shopify:hollow-pine.myshopify.com:variant:gid://shopify/ProductVariant/71", product: "Wool Beanie", variant: "Navy", priceMinor: 2800, imageUrl: null, stock: 4 },
    { variantKey: "shopify:hollow-pine.myshopify.com:variant:gid://shopify/ProductVariant/72", product: "Field Tee", variant: null, priceMinor: 3500, imageUrl: null, stock: 0 }]
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.fulfill({ status: 200, contentType: "image/png", headers: H, body: Buffer.alloc(0) });
  if (p === "/relay/retailer/demand") return j({ store: "Hollow Pine", platform: st.platform, currency: "GBP", watchedItems: [], followers: 0, shoppersWatchingItems: 0 });
  if (p === "/relay/retailer/offers") return j({ offers: [] });
  if (p === "/relay/retailer/results") return j({ supported: st.platform === "shopify", swaps: [], returns: [], totals: { swaps: 0, swapValueMinor: 0, returns: 0, returnValueMinor: 0, swapShare: null }, currency: "GBP" });
  if (p === "/relay/retailer/payments") return j({ method: "shopify", stripe: { connected: false, ready: false }, cardPossible: false });
  if (p === "/relay/retailer/royal-mail") return j({ connected: false, services: [] });
  if (p === "/relay/retailer/auctions" && m === "GET") return st.platform === "shopify" ? j({ store: "Hollow Pine", canOrder: st.canOrder, durations: [24, 72, 120, 168], conditions, auctions: st.auctions }) : j({ error: "shopify_only" }, 400);
  if (p === "/relay/retailer/auctions/catalogue") return j({ items: st.items });
  if (p === "/relay/retailer/auctions" && m === "POST") {
    const b = JSON.parse(req.postData() || "{}"); st.posts.push(b); await new Promise(r => setTimeout(r, 200));
    if (st.answer) { const a = st.answer; st.answer = null; return j(a.body, a.status); }
    const made = view({ id: "a6666666-6666-4666-8666-66666666666" + st.posts.length, title: b.title || "Wool Beanie", endsAt: now + b.hours * 3600e3 });
    st.auctions.unshift(made); return j({ auction: made });
  }
  const cancel = /^\/relay\/retailer\/auctions\/([0-9a-f-]{36})\/cancel$/.exec(p);
  if (cancel) { st.posts.push({ cancel: cancel[1] }); const a = st.auctions.find(x => x.id === cancel[1]); a.status = "cancelled"; a.outcome = "cancelled"; return j({ auction: a }); }
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; the dashboard must ask inside the page"); });
await page.goto(origin + "/retailer.html#key=rk_" + "k".repeat(40));
await page.getByRole("heading", { name: "Auctions" }).waitFor();
const list = page.locator("#aucList");
await list.getByText("Wool Beanie, Navy").first().waitFor();

// 1. What happened to each auction, in words, with links to the shop's own orders.
const rowOf = (title) => list.locator(".row", { hasText: title });
assert.match(await rowOf("Field Tee").innerText(), /Sold for £72\.00 plus £3\.95 delivery, and paid\. Send it to the address on the order\./);
assert.equal(await rowOf("Field Tee").getByRole("link", { name: "View order #9001 in Shopify" }).getAttribute("href"), "https://admin.shopify.com/store/hollow-pine/orders/9001");
assert.match(await rowOf("Rain Shell").innerText(), /Offered to the next bidder for £61\.00\. Waiting for payment until .+\. Don't send it until it's paid\./);
assert.match(await rowOf("Old Scarf").innerText(), /Ended with no bids\./);
const live1 = list.locator(".row").filter({ hasText: "£31.00 now, 4 bids." });
assert.equal(await live1.getByRole("button", { name: "Cancel" }).count(), 0, "can't cancel once someone has bid");
const live2 = list.locator(".row").filter({ hasText: "No bids yet. Starts at £10.00." });
assert.equal(await live2.getByRole("button", { name: "Cancel" }).count(), 1);
assert.ok(!/ · /.test(await list.innerText()), "no facts glued together with dots");
await page.locator("#auc").screenshot({ path: "/tmp/shots/retailer-auctions-list.png" });
console.log("ok - the shop sees each auction and what happened to it in words, with links to its own orders");

// 2. Starting one from the catalogue: search, pick, condition, prices, how long, the promise; sent once.
await page.getByRole("button", { name: "Start an auction" }).click();
const form = page.locator("#aucForm");
await form.locator("#aucItem option").first().waitFor({ state: "attached" });
await page.locator("#aucFind").fill("tee");
assert.deepEqual(await form.locator("#aucItem option").allInnerTexts(), ["Field Tee (£35.00, 0 in stock)"]);
await page.locator("#aucFind").fill("");
await form.locator("#aucItem").selectOption({ label: "Wool Beanie, Navy (£28.00, 4 in stock)" });
await form.locator("select[name=condition]").selectOption("returned");
await form.locator("input[name=start]").fill("£12.50");
await form.locator("input[name=delivery]").fill("3.95");
await form.locator("select[name=hours]").selectOption("120");
await page.getByRole("button", { name: "Start auction" }).click();
await page.getByText("Tick the box to say you'll send it once it's paid and nobody for you will bid.").waitFor();
assert.equal(st.posts.length, 0, "nothing is sent until the box is ticked");
await form.locator("input[name=agree]").check();
if (process.env.SHOTS) await form.screenshot({ path: process.env.SHOTS + "/retailer-auction-form.png" });
await form.screenshot({ path: "/tmp/shots/retailer-auctions-form.png" });
await page.getByRole("button", { name: "Start auction" }).dblclick();
await page.getByText(/^Started\. Wool Beanie is up for auction until /).waitFor();
assert.equal(st.posts.length, 1, "started once for a double click");
assert.deepEqual(st.posts[0], { kind: "catalogue", condition: "returned", startMinor: 1250, deliveryMinor: 395, hours: 120, agree: true, photos: [],
  variantKey: "shopify:hollow-pine.myshopify.com:variant:gid://shopify/ProductVariant/71" });
assert.equal(await form.isHidden(), true, "the form closes once it's started");
console.log("ok - starting an auction from the catalogue sends exactly what the shop chose, once");

// 3. A one-off: what it is and a photo (made smaller on the device first); plain words when the server refuses.
await page.getByRole("button", { name: "Start an auction" }).click();
await form.locator("input[name=kind][value=oneoff]").check();
await form.locator("input[name=title]").fill("Waxed jacket, sample");
await form.locator("input[name=size]").fill("M");
await form.locator("textarea[name=description]").fill("Worn once at a shoot.");
// A big made-up photo: a 3000 x 2000 picture drawn in the page, as a phone camera's would be.
const big = await page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 2000; const g = c.getContext("2d");
  for (let i = 0; i < 400; i++) { g.fillStyle = "hsl(" + (i * 37 % 360) + ",40%," + (30 + i % 40) + "%)"; g.fillRect((i * 97) % 3000, (i * 53) % 2000, 300, 200); }
  const b = await new Promise(r => c.toBlob(r, "image/png")); return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await form.locator("#aucPhotos").setInputFiles({ name: "jacket.png", mimeType: "image/png", buffer: Buffer.from(big) });
await form.locator("#aucThumbs img").waitFor();
await form.locator("input[name=start]").fill("40");
await form.locator("input[name=delivery]").fill("0");
await form.locator("input[name=agree]").check();
st.answer = { status: 429, body: { error: "too_many_live", max: 20 } };
await page.getByRole("button", { name: "Start auction" }).click();
await page.getByText("You have 20 auctions running, the most at once. Start this one when one ends.").waitFor();
const sent = st.posts.at(-1);
assert.equal(sent.kind, "oneoff"); assert.equal(sent.title, "Waxed jacket, sample"); assert.equal(sent.size, "M"); assert.equal(sent.photos.length, 1);
assert.match(sent.photos[0], /^data:image\/jpeg;base64,/, "sent as a JPEG");
assert.ok(sent.photos[0].length * 0.75 < 440 * 1024, "made smaller first: " + Math.round(sent.photos[0].length * 0.75 / 1024) + " KB");
await page.getByRole("button", { name: "Start auction" }).click();
await page.getByText(/^Started\. Waxed jacket, sample is up for auction until /).waitFor();
console.log("ok - a one-off is sent with its photo made smaller on the device first; refusals are said in plain words");

// 4. Cancelling an auction nobody has bid on.
await list.locator(".row").filter({ hasText: "No bids yet. Starts at £10.00." }).first().getByRole("button", { name: "Cancel" }).click();
await page.getByText("Cancelled.", { exact: true }).waitFor();
assert.ok(st.posts.some(x => x.cancel));
await list.getByText("Cancelled before anyone bid.").first().waitFor();
console.log("ok - an auction nobody has bid on can be cancelled");

// 5. Without Shopify's permission to create orders: told how to give it, and can't start one.
st.canOrder = false;
await page.getByRole("button", { name: "Refresh" }).click();
await page.getByText("To run auctions, Relay needs your permission to create orders in Shopify", { exact: false }).waitFor();
assert.equal(await page.getByRole("button", { name: "Start an auction" }).isDisabled(), true);
console.log("ok - without permission to create orders, the shop is told how to give it");

// 6. Square shops (still on Square's test system) don't see auctions.
st.platform = "square";
await page.reload();
await page.locator("#shop").getByText("Hollow Pine").waitFor();
await page.waitForTimeout(300);
assert.equal(await page.locator("#auc").isHidden(), true);
console.log("ok - a Square shop doesn't see auctions");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS auctions in the shop's dashboard");
await browser.close(); server.close();
