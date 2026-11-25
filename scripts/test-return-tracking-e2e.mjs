// End to end: return tracking through Relay's real server (worker/worker.js on this computer, scripts/local-worker.mjs:
// every route, check and SQL statement as Cloudflare runs them, on a real SQLite database) and the real app in a browser.
//
// What stands in, because it lives outside Relay:
//  * Ship24 (the carrier tracking service): answered here, never called for real. What it "says" is set by the test.
//  * The shopper's inbox: each email is MADE UP, read by Relay's real reader (classifyEmail) and kept exactly as a scan
//    keeps it. The bank: one made-up payment row, as a bank read would keep it.
// Nothing leaves this computer; people, shops, order numbers, tracking numbers and amounts are invented.
//
// One return, start to finish, and what Relay may say at each point:
//  1. The shop's return-label email (with the parcel's tracking number): "Return started", nothing else ticked. The fact a
//     future instant refund asks for (onItsWay) is null.
//  2. The carrier's label email that talks about dropping it off later: still only started.
//  3. The receipt is opened: the carrier is asked once. It has only been told to expect the parcel: not on its way.
//  4. The carrier scans it: "Sent back", from the carrier's tracking, with the scan's time; onItsWay says so. One parcel
//     counted against the month's allowance, however often it's looked at.
//  5. The shop's "we've received your return, we'll process your refund": received, and NOT refunded.
//  6. Money in from the shop on the shopper's own bank payments: "Refund received", seen in the bank.
//  7. A second receipt: the shopper pastes a tracking number by hand. The real route refuses unknown fields and things that
//     aren't tracking numbers; a good one is saved, shows as "You said", and confirms nothing on its own.
//  8. Someone else can't read or change any of it (404).
//  9. In the app, at phone size: the receipt's page shows that timeline, each step with where Relay learned it; opening it
//     asks the carrier at most once and nothing is asked on a timer.
// Screenshots go to RELAY_RETURNS_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
import { classifyEmail, returnFactsFor } from "../worker/gmail.js";
import { ensureBankTables } from "../worker/bank.js";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url);
const SHOTS = process.env.RELAY_RETURNS_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const LIVE_API = "https://relay-square-api2.9pts72cy5j.workers.dev";

const TYPES = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const app = createServer(async (req, res) => {
  try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => app.listen(0, "127.0.0.1", r));
const APP = "http://127.0.0.1:" + app.address().port;
const w = await startLocalWorker({ appOrigin: APP });

// Ship24's stand-in, in front of the local worker's own "nothing outside is reachable".
const ship = { calls: [], says: null };
const inner = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input && input.url ? input.url : input);
  if (url.startsWith("https://api.ship24.com/")) {
    ship.calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers && init.headers.Authorization });
    return Response.json({ data: { trackings: ship.says ? [ship.says] : [] } });
  }
  return inner(input, init);
};

const DAY = 864e5, day = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(w.origin + path, { method, headers: { "content-type": "application/json", origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { j = null; }
  return { status: r.status, body: j };
};
const unb32 = t => { const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of t.replace(/\s/g, "")) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(o); };
async function signUp(email, name) {
  const n = w.emails.length;
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email } })).status, 200);
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails[n].text)[1];
  const token = (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).body.sessionToken;
  const s = await call("/relay/my/2fa/setup", { method: "POST", token, body: {} });
  assert.equal((await call("/relay/my/2fa/enable", { method: "POST", token, body: { code: await _codeAt(unb32(s.body.secret), Math.floor(Date.now() / 30000)) } })).status, 200, "second step on for " + email);
  await call("/relay/my/profile", { method: "POST", token, body: { name } });
  return { email, name, token, id: w.sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id };
}
const sam = await signUp("sam.returner@example.com", "Sam Returner"), ivy = await signUp("ivy.other@example.com", "Ivy Other");

// A receipt, pasted in through the real route (so the real reader made it).
const paste = async (who, shop, domain, item, pence, ref, on) => {
  const d = longDay(on);
  const r = await call("/relay/my/receipts/add-pasted", { method: "POST", token: who.token, body: { email:
    `Your ${shop} order is confirmed\n${shop} <orders@${domain}>\n${d} at 10:12\nTo: ${who.email}\n\nThanks for your order!\nOrder number: ${ref}\nOrder date: ${d}\n\n${item}  Qty 1  £${(pence / 100).toFixed(2)}\n\nSubtotal £${(pence / 100).toFixed(2)}\nDelivery £0.00\nTotal £${(pence / 100).toFixed(2)}\n` } });
  assert.equal(r.status, 200, "pasted: " + JSON.stringify(r.body)); assert.equal(r.body.items[0].name, item);
  return r.body.id;
};
const BOOTS = await paste(sam, "Kestrel Outdoor", "kestrel-outdoor.example", "Ridgeline Walking Boots", 8900, "KO-1001", day(-15));
const LAMP = await paste(sam, "Larkspur Home", "larkspur-home.example", "Brass Table Lamp", 6000, "LK-2002", day(-6));
// An email arrives in Sam's inbox: read by the real reader, kept as a scan keeps it.
let n = 0;
const arrives = (who, from, subject, text, on) => {
  const raw = `From: ${from}\r\nTo: ${who.email}\r\nSubject: ${subject}\r\nDate: ${new Date(on + "T10:00:00Z").toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
  const { details, status } = classifyEmail(raw, {});
  w.sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), who.id, "e2e-" + (++n), status || "pending", JSON.stringify(details), Date.now() - (100 - n) * 1000);
  return details;
};
const list = async (who) => { const r = await call("/relay/my/receipts?all=1", { token: who.token }); assert.equal(r.status, 200); return r.body.receipts; };
const card = async (who, id) => (await list(who)).find(c => c.id === id);
const stepsOf = (c) => c.returnTracking.steps.map(s => [s.step, s.done, s.from ? s.from.by + ":" + s.from.via : s.missed ? "missed" : null]);
const facts = () => returnFactsFor(w.env, sam.id, BOOTS);
const TN = "KO123456789GB", SHOP = "Kestrel Outdoor <returns@kestrel-outdoor.example>", RM = "Royal Mail <no-reply@royalmail.com>";

// 1. The shop's return-label email.
{
  assert.equal((await card(sam, BOOTS)).returnTracking, undefined, "no return yet");
  const d = arrives(sam, SHOP, "Your return label for order KO-1001", `Your Royal Mail return label is attached. Tracking number: ${TN}. Drop it off at any Post Office. Once it has been dropped off, it is on its way back to us.`, day(-5));
  assert.equal(d.kind, "return_instructions");
  const c = await card(sam, BOOTS);
  assert.deepEqual(stepsOf(c), [["started", true, "shop:email"], ["sent", false, null], ["received", false, null], ["refunded", false, null]], "started, and nothing else");
  assert.deepEqual([c.returnTracking.trackingNumber, c.returnTracking.carrier, c.returnInTransit, c.returnReceived, c.returnTracking.onItsWay], [TN, "Royal Mail", false, false, null]);
  assert.deepEqual([(await facts()).onItsWay, (await facts()).statement], [null, "Not confirmed on its way"]);
  console.log("ok - the shop's return-label email starts the return with the parcel's tracking number; 'once it has been dropped off' confirms nothing");
}
// 2. The carrier's own label email, which talks about dropping off later.
{
  const d = arrives(sam, RM, "Your return label is ready", `Here's your return label for Kestrel Outdoor.\nOnce you've dropped off your parcel at a Post Office we'll email you.\nTracking number: ${TN}`, day(-5));
  assert.deepEqual([d.kind, d.stage], ["return_update", "started"]);
  const c = await card(sam, BOOTS);
  assert.deepEqual([c.returnTracking.state, c.returnInTransit, c.returnTracking.onItsWay], ["started", false, null], "a label is not a drop-off");
  console.log("ok - the carrier's label email is a label, not a drop-off");
}
// 3 and 4. Opening the receipt asks the carrier (Ship24's stand-in).
const parcel = (id, who = sam) => call("/relay/my/receipts/" + id + "/return-parcel", { token: who.token });
const waited = (mins) => w.sqlite.prepare("UPDATE parcel_tracks SET checked_at = checked_at - ? WHERE tracking_number = ?").run(mins * 60e3, TN);
const SCAN = day(-2) + "T09:14:00";
{
  let r = await parcel(BOOTS);
  assert.deepEqual([r.status, r.body.available, ship.calls.length], [200, false, 0], "live tracking is off until its key is set: nothing asked");
  w.env.SHIP24_API_KEY = "local-not-a-key";
  ship.says = { shipment: { statusMilestone: "info_received", delivery: {} }, events: [{ statusMilestone: "info_received", occurrenceDatetime: day(-5) + "T10:00:00" }] };
  r = await parcel(BOOTS);
  assert.equal(ship.calls.length, 1, "asked once, when the receipt is opened");
  assert.deepEqual([ship.calls[0].url, ship.calls[0].body], ["https://api.ship24.com/public/v1/trackers/track", { trackingNumber: TN, destinationCountryCode: "GB", courierCode: ["gb-post"] }], "only the tracking number (and Royal Mail's code)");
  assert.ok(!JSON.stringify(ship.calls).includes("sam.returner") && !JSON.stringify(ship.calls).includes("KO-1001"), "nothing about the shopper or the order");
  assert.deepEqual([r.body.returnTracking.state, r.body.returnInTransit, r.body.onItsWay], ["started", false, null], "the carrier has only been told to expect it: not on its way");
  await parcel(BOOTS);
  assert.equal(ship.calls.length, 1, "opened again straight away: not asked again");
  // Later, the carrier has scanned it. Its expected delivery day is still to come.
  waited(15);
  ship.says = { shipment: { statusMilestone: "in_transit", delivery: { estimatedDeliveryDate: day(2) + "T00:00:00" } },
    events: [{ statusMilestone: "info_received", occurrenceDatetime: day(-5) + "T10:00:00" }, { statusMilestone: "in_transit", occurrenceDatetime: SCAN }, { statusMilestone: "in_transit", occurrenceDatetime: day(-1) + "T22:40:00" }] };
  r = await parcel(BOOTS);
  assert.deepEqual([ship.calls.length, ship.calls[1].url, ship.calls[1].method], [2, "https://api.ship24.com/public/v1/trackers/search/" + TN + "/results", "GET"], "looked up again, not started again");
  assert.deepEqual(r.body.returnTracking.steps[1], { step: "sent", done: true, at: day(-2), from: { by: "carrier", name: "Royal Mail", via: "tracking" }, atTime: SCAN }, "sent on the day of the first scan, never the expected delivery day");
  const want = { by: "carrier", name: "Royal Mail", at: day(-2), via: "tracking", atTime: SCAN };
  assert.deepEqual([r.body.returnInTransit, r.body.returnReceived, r.body.onItsWay], [true, false, want]);
  assert.deepEqual([(await facts()).onItsWay, (await facts()).statement], [want, "On its way: confirmed by Royal Mail's tracking, first scan " + SCAN], "the same fact on the server, for a future instant refund");
  assert.equal(w.sqlite.prepare("SELECT n FROM parcel_track_uses").get().n, 1, "one parcel counted against the month's allowance, however often it's looked at");
  console.log("ok - the carrier asked only when the receipt is opened; 'expecting it' is not on its way; its first scan is, with the scan's own time; one parcel counted");
}
// 5. The shop has it, and promises the refund.
{
  const d = arrives(sam, SHOP, "We've received your return", "We've received your return for order KO-1001. We'll process your refund within 5 working days.", day(-1));
  assert.deepEqual([d.kind, d.stage], ["return_update", "received"]);
  const c = await card(sam, BOOTS);
  // (Both the shop and Royal Mail said the return started, the same day: the carrier's word is shown first.)
  assert.deepEqual(stepsOf(c), [["started", true, "carrier:email"], ["sent", true, "carrier:tracking"], ["received", true, "shop:email"], ["refunded", false, null]], "received, and not refunded: a promise isn't a refund");
  assert.deepEqual([c.returnReceived, c.returnInTransit, c.returnTracking.onItsWay.atTime], [true, false, SCAN]);
  const before = ship.calls.length; waited(600);
  assert.equal((await parcel(BOOTS)).body.reason, "arrived"); assert.equal(ship.calls.length, before, "at the shop: the carrier isn't asked again");
  console.log("ok - 'we've received your return, we'll process your refund' is received and not refunded; the carrier is no longer asked");
}
// 6. The money arrives in Sam's bank.
{
  await ensureBankTables(w.env.RELAY_DB);
  const pay = (who, id, on, minor, description) => w.sqlite.prepare("INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, merchant, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(who.id, id, "conn-" + who.id, "Everyday Account ending 4321", on, minor, "GBP", description, null, Date.now());
  pay(sam, "p-in", day(0), -8900, "KESTREL OUTDOOR LTD"); pay(sam, "p-salary", day(0), -8900, "MADE UP EMPLOYER LTD"); pay(ivy, "p-ivy", day(0), -8900, "KESTREL OUTDOOR LTD");
  const c = await card(sam, BOOTS);
  assert.deepEqual(c.returnTracking.steps[3], { step: "refunded", done: true, at: day(0), from: { by: "bank", name: "Everyday Account ending 4321", via: "bank" }, amountPence: 8900, currency: "GBP" });
  assert.equal(c.returnTracking.state, "refunded");
  assert.equal((await card(sam, LAMP)).returnTracking, undefined, "money in never starts a return on a receipt that has none");
  console.log("ok - money in from the shop on the shopper's own bank payments shows as the refund received");
}
// 7. A tracking number pasted by hand, on another receipt.
{
  const sent = (body, who = sam) => call("/relay/my/receipts/" + LAMP + "/return-sent", { method: "POST", token: who.token, body });
  for (const [body, why] of [[{ trackingNumber: "LK123456789GB", shop: "x" }, "a field Relay doesn't take"], [{ trackingNumber: "not a number!" }, "not a tracking number"], [{ trackingNumber: "ABCDEFGHIJ" }, "no digits"],
    [{ trackingNumber: "LK123456789GB", sentOn: day(3) }, "a day still to come"], [{ trackingNumber: "LK123456789GB", carrier: "Made Up Couriers" }, "a carrier not on the list"]])
    assert.equal((await sent(body)).status, 400, "refused: " + why);
  const r = await sent({ trackingNumber: " lk 1234-56789 gb ", sentOn: day(-1) });
  assert.deepEqual([r.status, r.body.carrierGuessed, r.body.returnTracking.trackingNumber, r.body.returnTracking.carrier], [200, true, "LK123456789GB", "Royal Mail"], "pasted with spaces and dashes: tidied; Royal Mail's own format");
  assert.deepEqual([r.body.returnTracking.steps[1].from, r.body.returnInTransit, r.body.onItsWay, r.body.statement], [{ by: "you", name: null, via: "app" }, false, null, "Not confirmed on its way"], "the shopper's word, even with a number, confirms nothing");
  // 8. Not Ivy's.
  assert.equal((await sent({ trackingNumber: "LK123456789GB" }, ivy)).status, 404); assert.equal((await parcel(BOOTS, ivy)).status, 404);
  assert.equal(await returnFactsFor(w.env, ivy.id, BOOTS), null, "nor on the server");
  assert.ok((await list(ivy)).every(c => !c.returnTracking), "and none of it is on her list");
  console.log("ok - a tracking number pasted by hand: checked by the real route, saved, shown as the shopper's word, confirms nothing; nobody else can read or change it");
}

// 9. In the app.
const { chromium } = require("playwright");
const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block", hasTouch: true });
  await skipInterests(ctx);
  const asked = [];
  await ctx.route(/^https?:\/\//, async route => {
    const req = route.request(), url = req.url();
    if (url.startsWith(APP)) return route.continue();
    if (!url.startsWith(LIVE_API)) return route.abort();
    const path = url.slice(LIVE_API.length);
    asked.push(req.method() + " " + path.split("?")[0]);
    const headers = { ...req.headers() }; delete headers.host;
    const r = await fetch(w.origin + path, { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() });
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(APP + "/index.html");
  await page.evaluate(s => localStorage.setItem("relay.session.v1", JSON.stringify({ token: s.token, email: s.email, expiresAt: Date.now() + 864e5 })), sam);
  await page.reload();
  await page.locator("#foot button").first().waitFor();
  const openFrom = async (text) => {
    const hit = page.locator("#homePage .h2-item, #homePage .hl-sq, #homePage .hx-sq, #homePage .hx-live", { hasText: text }).first();
    await hit.waitFor(); await hit.click();
    const sh = page.locator(".rl-back .rl-sheet").last(); await sh.locator(".rl-rt").waitFor(); await page.waitForTimeout(600); return sh;
  };
  const read = (sh) => sh.locator(".rl-rt-step").evaluateAll(xs => xs.map(x => [x.classList.contains("done"), x.innerText.replace(/\s+/g, " ").trim()]));
  let sh = await openFrom("Kestrel Outdoor");
  assert.deepEqual(await read(sh), [[true, "Return started From Royal Mail's email, " + shortDay(day(-5))], [true, "Sent back From Royal Mail's tracking, " + shortDay(day(-2)) + " at 09:14"],
    [true, "Received by Kestrel Outdoor From Kestrel Outdoor's email, " + shortDay(day(-1))], [true, "Refund of £89.00 received Seen on your Everyday Account ending 4321, " + shortDay(day(0))]], "the whole return, each step with where Relay learned it");
  assert.match(await sh.locator(".rl-rt-tn").innerText(), /Tracking number KO123456789GB with Royal Mail/);
  assert.equal(asked.filter(a => /return-parcel/.test(a)).length, 0, "refunded: the carrier isn't asked");
  await sh.evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + "/e2e-return-whole-timeline.png" });
  const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" });
  // The lamp: only Sam's word so far. Opening it asks the carrier once; the stand-in knows nothing of this number yet.
  ship.says = null; const shipBefore = ship.calls.length;
  sh = await openFrom("Larkspur Home");
  assert.deepEqual(await read(sh), [[false, "Return started Relay wasn't told"], [true, "Sent back, on its way to Larkspur Home You said, " + shortDay(day(-1))], [false, "Received by Larkspur Home"], [false, "Refund issued"]]);
  await page.waitForTimeout(3000);
  assert.equal(asked.filter(a => /return-parcel/.test(a)).length, 1, "opening it asks about the parcel once, and not again while it stays open");
  assert.equal(ship.calls.length - shipBefore, 1, "one question to the carrier");
  assert.equal(await sh.locator("button", { hasText: "Change what you told Relay" }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "nothing wider than the phone");
  await sh.evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + "/e2e-return-you-said.png" });
  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
  console.log("ok - the app, against the real server: the whole timeline with where each step was learned; a return on the shopper's word says so; the carrier asked once on opening, never on a timer");
}
await browser.close();
globalThis.fetch = inner; await w.close(); app.close();
console.log("PASS return tracking end to end (real server and app on this computer; Ship24, the inbox and the bank stand in with made-up data)");
