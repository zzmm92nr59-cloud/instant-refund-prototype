// End to end: Swap & resell, the real app against Relay's real server.
//
// Unlike scripts/test-market-ui.mjs (which stubs the server), nothing here fakes a marketplace answer. Relay's own server
// code (worker/worker.js and everything it calls) runs on this computer with a real SQLite database built from
// worker/migrations (scripts/local-worker.mjs), and the app (index.html, account.js, served from this folder) talks to
// it in a real browser: the app's requests to Relay's address are sent on to the local server unchanged.
// Stand-ins, only for what lives outside Relay: Cloudflare's D1 binding (a thin wrapper over node:sqlite), the rate-limit
// bindings (limits.js counts in memory instead), Resend (sign-in emails are kept here so the test can open the link) and
// every other outside service (refused; the test checks the marketplace never needed one). Two-step sign-in is on, as
// live: each made-up member signs in by the email link and an authenticator code.
// Everyone is MADE UP (@example.com). Nothing here talks to Relay's live server or database.
//
// Three members, each in their own browser: Sam sells, Bea buys, Eve is someone else. Then Relay's team (an admin).
//   API, as each member: listing rules (own receipts only, the title from the receipt, photos checked by their bytes),
//     asking, accepting, messages (only the two people in it, contact details refused, emoji and long text kept,
//     direction-flipping characters removed), ending and reporting, taking down, a blocked member can't list, ask or
//     message, deleting an account removes their listings, requests and messages and puts others' items back on sale.
//     Eve can never read or change anything that isn't hers: every route tried with her session.
//   In the app: Sam lists an item with a photo, price, condition and handover; Bea finds it in Browse with its photo and
//     asks for it (a double tap asks once); Sam accepts and messages; Bea replies (emoji, long text, Enter twice sends
//     once); each sees the other's message arrive while the conversation is open; nothing is asked while it's closed or
//     Relay is in the background; the matched item leaves Browse for everyone; Bea reports the conversation; Sam takes
//     the listing down; the keyboard leaves the message box in view; bigger text stays on the page.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
import { skipInterests, goTab, waitOutDoubleTap, openProfile } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const started = Date.now();
const SHOTS = process.env.RELAY_SHOTS || "/tmp/shots/marketplace-e2e";
await mkdir(SHOTS, { recursive: true });
const LIVE_API = "https://relay-square-api2.9pts72cy5j.workers.dev";

// The app, served from this folder.
const TYPES = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".jpg": "image/jpeg", ".webp": "image/webp" };
const app = createServer(async (req, res) => {
  try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => app.listen(0, "127.0.0.1", r));
const APP = "http://127.0.0.1:" + app.address().port;
const w = await startLocalWorker({ appOrigin: APP });
const one = (sql, ...a) => w.sqlite.prepare(sql).get(...a);
const count = (sql, ...a) => Number(Object.values(w.sqlite.prepare(sql).get(...a))[0]);

// ---- Members, signed in for real: the email link, then an authenticator app as the second step ----------------------
const call = async (path, { method = "GET", body, token, raw } = {}) => {
  const r = await fetch(w.origin + path, { method, headers: { "content-type": "application/json", origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { j = null; }
  return { status: r.status, body: j, type: r.headers.get("content-type") || "" };
};
const unb32 = t => { const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of t.replace(/\s/g, "")) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(o); };
async function signUp(email, name) {
  const n = w.emails.length;
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email } })).status, 200, "sign-in link for " + email);
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails[n].text)[1];
  const v = await call("/relay/auth/verify", { method: "POST", body: { token: link } });
  const token = v.body.sessionToken; assert.ok(token, "signed in " + email);
  assert.equal((await call("/relay/my/resale/feed", { token })).status, 403, "nothing but setting up a second step until there is one");
  const s = await call("/relay/my/2fa/setup", { method: "POST", token, body: {} });
  const code = await _codeAt(unb32(s.body.secret), Math.floor(Date.now() / 30000));
  assert.equal((await call("/relay/my/2fa/enable", { method: "POST", token, body: { code } })).status, 200, "second step on for " + email);
  await call("/relay/my/profile", { method: "POST", token, body: { name } });
  return { email, name, token };
}
const paste = async (who, store, item, pence, ref, date = "2 September 2026") => {
  const r = await call("/relay/my/receipts/add-pasted", { method: "POST", token: who.token, body: { email:
    `Your ${store} order is confirmed\n${store} <orders@${store.toLowerCase().replace(/\W/g, "")}.example>\n${date} at 10:12\nTo: ${who.email}\n\nThanks for your order!\nOrder number: ${ref}\nOrder date: ${date}\n\n${item}  Qty 1  £${(pence / 100).toFixed(2)}\n\nSubtotal £${(pence / 100).toFixed(2)}\nDelivery £0.00\nTotal £${(pence / 100).toFixed(2)}\n` } });
  assert.equal(r.status, 200); assert.equal(r.body.items[0].name, item, "the pasted receipt was read");
  return r.body.id;
};
const sam = await signUp("sam.seller@example.com", "Sam Seller");
const bea = await signUp("bea.buyer@example.com", "Bea Buyer");
const eve = await signUp("eve.other@example.com", "Eve Other");
const admin = await signUp("team.admin@example.com", "Team Admin");
const samShirt = await paste(sam, "Fennel", "Linen Overshirt", 4500, "FN-20931");
const samLamp = await paste(sam, "Larkspur Home", "Brass Desk Lamp", 6000, "LK-5521");
const samVase = await paste(sam, "Larkspur Home", "Ceramic Vase", 4000, "LK-5530");
const beaScarf = await paste(bea, "Brindle and Co", "Merino Wool Scarf", 3500, "BC-118");
const eveBoots = await paste(eve, "Alpine Active", "Trail Boots", 9000, "AA-77");
console.log("ok - four made-up members signed in for real (email link and authenticator code) and pasted receipts");

// A real photo (PNG bytes), and one that only says it's a photo.
const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 3)]).toString("base64");
const FAKE = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>".repeat(10)).toString("base64");

// ---- 1. The server, as each member ------------------------------------------------------------------------------------
{
  const L = (who, b) => call("/relay/my/resale/listings", { method: "POST", token: who.token, body: { receiptId: samLamp, itemIndex: 0, condition: "good", askPence: 2500, agree: true, handover: "post", ...b } });
  assert.equal((await L(eve)).status, 404, "Eve can't list Sam's receipt");
  assert.equal((await L(sam, { title: "Gold watch" })).status, 400, "the title only ever comes from the receipt");
  assert.equal((await L(sam, { photos: [FAKE] })).status, 400, "a photo is checked by its bytes");
  assert.equal((await L(sam, { handover: "collect" })).body.error, "area_needed");
  const lamp = await L(sam, { photos: [PNG], size: "One size", note: "Barely used 💡" });
  assert.equal(lamp.status, 200);
  assert.equal((await L(sam)).body.error, "already_listed", "one listing per item");
  const vase = await call("/relay/my/resale/listings", { method: "POST", token: sam.token, body: { receiptId: samVase, itemIndex: 0, condition: "like_new", askPence: 1200, agree: true, handover: "either", area: "sw11 1aa", swapOk: true } });
  const scarf = await call("/relay/my/resale/listings", { method: "POST", token: bea.token, body: { receiptId: beaScarf, itemIndex: 0, condition: "good", agree: true } });
  assert.equal(one("SELECT area FROM resale_listings WHERE id = ?", vase.body.id).area, "SW11", "only the postcode area is kept");

  // Browse: everyone else's, never your own, never who listed it.
  const feedOf = async who => (await call("/relay/my/resale/feed", { token: who.token })).body.listings;
  const beaFeed = await feedOf(bea);
  assert.deepEqual(beaFeed.map(l => l.title).sort(), ["Brass Desk Lamp", "Ceramic Vase"]);
  assert.ok(!(await feedOf(sam)).some(l => l.title === "Brass Desk Lamp"), "not your own");
  assert.ok(!/sam|seller@|FN-|LK-|receipt/i.test(JSON.stringify(beaFeed)), "nothing that says who's selling or which receipt");
  assert.equal(beaFeed.find(l => l.title === "Brass Desk Lamp").note, "Barely used 💡", "emoji kept in a note");
  const img = await fetch(w.origin + "/relay/my/resale/listings/" + lamp.body.id + "/image", { headers: { authorization: "Bearer " + bea.token } });
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png", "served as what it really is");
  assert.equal((await fetch(w.origin + "/relay/my/resale/listings/" + lamp.body.id + "/image")).status, 401, "photos need sign-in");

  // Bea asks; Eve asks too. Only Sam can accept, and accepting declines Eve.
  const ask = (who, id, b) => call("/relay/my/resale/listings/" + id + "/ask", { method: "POST", token: who.token, body: b });
  assert.equal((await ask(sam, lamp.body.id, { kind: "buy" })).body.error, "own_listing");
  assert.equal((await ask(bea, lamp.body.id, { kind: "buy", message: "Is it still available? 😊" })).status, 200);
  assert.equal((await ask(bea, lamp.body.id, { kind: "buy" })).body.error, "already_asked", "asking twice is once");
  assert.equal((await ask(eve, lamp.body.id, { kind: "buy" })).status, 200);
  assert.equal((await ask(bea, vase.body.id, { kind: "swap", offeredListingId: lamp.body.id })).body.error, "offer_one_of_your_listings", "can't offer someone else's item");
  assert.equal((await ask(bea, vase.body.id, { kind: "swap", offeredListingId: scarf.body.id })).status, 200, "a swap for her own listing");
  let mine = (await call("/relay/my/resale/mine", { token: sam.token })).body;
  const lampReqs = mine.listings.find(l => l.id === lamp.body.id).requests;
  assert.deepEqual(lampReqs.map(q => q.who), ["Member 1", "Member 2"], "askers are only ever numbered");
  assert.equal(lampReqs[0].message, "Is it still available? 😊");
  assert.ok(!JSON.stringify(mine).includes("bea.buyer") && !JSON.stringify(mine).includes("Bea"), "never the buyer's name or email");
  const beaReq = lampReqs[0].id, eveReq = lampReqs[1].id;
  for (const who of [bea, eve]) assert.equal((await call("/relay/my/resale/requests/" + beaReq + "/accept", { method: "POST", token: who.token })).status, 404, "only the seller accepts");
  assert.equal((await call("/relay/my/resale/requests/" + beaReq + "/accept", { method: "POST", token: sam.token })).status, 200);
  assert.equal(one("SELECT status FROM resale_requests WHERE id = ?", eveReq).status, "declined", "the others are told no");
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", lamp.body.id).status, "matched");
  assert.ok(!(await feedOf(eve)).some(l => l.id === lamp.body.id), "a matched item leaves Browse");
  assert.equal((await fetch(w.origin + "/relay/my/resale/listings/" + lamp.body.id + "/image", { headers: { authorization: "Bearer " + eve.token } })).status, 404, "and its photo");

  // Messages: only the two people in the conversation.
  const msgs = (who, id = beaReq) => call("/relay/my/resale/requests/" + id + "/messages", { token: who.token });
  const say = (who, text, id = beaReq) => call("/relay/my/resale/requests/" + id + "/messages", { method: "POST", token: who.token, body: { body: text } });
  assert.equal((await msgs(eve)).status, 404, "Eve can't read a conversation she isn't in");
  assert.equal((await say(eve, "hello")).status, 404, "or write in it");
  assert.equal((await msgs(eve, eveReq)).status, 200, "her own declined request she can see");
  assert.equal((await say(eve, "please?", eveReq)).body.error, "item_gone", "but not message in: it says plainly the item has gone");
  assert.equal((await msgs(eve, eveReq)).body.itemGone, true);
  assert.equal((await say(sam, "Hi! 👋 Yes, it's yours. Collect Saturday?")).status, 200);
  const long = "Saturday works. ".repeat(40).trim(); // 639 characters
  assert.equal((await say(bea, long)).status, 400, "longer than a message can be is refused, not cut short");
  assert.equal((await say(bea, long.slice(0, 500))).status, 200, "500 characters is fine");
  assert.equal((await say(bea, "Great 🙂👍🏽 see you then ‮gnp.exe")).status, 200);
  for (const t of ["mail me bea.buyer@example.com", "call 07700 900123", "see https://example.com/x"]) assert.equal((await say(bea, t)).body.error, "no_contact_details", t);
  assert.equal((await say(bea, "   ")).status, 400);
  const thread = (await msgs(bea)).body;
  assert.deepEqual(thread.messages.map(m => m.mine), [false, true, true]);
  assert.equal(thread.with, "Seller"); assert.equal(thread.open, true);
  assert.equal(thread.messages[0].body, "Hi! 👋 Yes, it's yours. Collect Saturday?", "emoji kept");
  assert.equal(thread.messages[1].body.length, 500, "long text kept whole");
  assert.equal(thread.messages[2].body, "Great 🙂👍🏽 see you then gnp.exe", "the character that flips text direction is removed");
  assert.ok(!JSON.stringify(thread).includes("sam.seller") && !JSON.stringify(thread).includes("Sam"), "the seller stays anonymous");

  // Eve tries every other door with her own session: someone else's listing, request or conversation is "not found".
  const doors = [["POST", "/relay/my/resale/listings/" + lamp.body.id + "/withdraw"], ["POST", "/relay/my/resale/listings/" + vase.body.id + "/withdraw"],
    ["POST", "/relay/my/resale/requests/" + beaReq + "/end", {}], ["POST", "/relay/my/resale/requests/" + beaReq + "/report", { reason: "x" }],
    ["POST", "/relay/my/resale/requests/" + beaReq + "/decline"], ["GET", "/relay/my/resale/listings/" + lamp.body.id + "/photos/1"],
    ["POST", "/relay/my/resale/listings/" + vase.body.id + "/edit", { askPence: 1 }], ["POST", "/relay/my/resale/requests/" + beaReq + "/block"]];
  for (const [method, path, body] of doors) {
    const r = await call(path, { method, token: eve.token, body });
    assert.ok(r.status === 404 || r.status === 400, method + " " + path + " → " + r.status);
  }
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", vase.body.id).status, "active", "Sam's vase unchanged");
  assert.equal(one("SELECT status FROM resale_requests WHERE id = ?", beaReq).status, "accepted", "the conversation unchanged");
  assert.equal(count("SELECT COUNT(*) FROM resale_member_blocks"), 0, "Eve blocked no one");
  // A listing changes only through its own edit route (below): anything sent to the listing's own address is refused.
  assert.equal((await call("/relay/my/resale/listings/" + vase.body.id, { method: "POST", token: sam.token, body: { askPence: 1 } })).status, 400);
  assert.ok([400, 404].includes((await call("/relay/my/resale/listings/" + vase.body.id, { method: "PUT", token: eve.token, body: { askPence: 1 } })).status));
  assert.equal(one("SELECT ask_pence FROM resale_listings WHERE id = ?", vase.body.id).ask_pence, 1200);
  console.log("ok - server: listing rules, Browse without names, asking once, only the seller accepts, messages only between the two (emoji, long text, no contact details, no direction tricks), and Eve can't open or change anything of theirs");

  // Reporting a conversation ends it and puts the item back on sale; Relay's team blocks the member reported.
  assert.equal((await call("/relay/my/resale/requests/" + beaReq + "/report", { method: "POST", token: bea.token, body: { reason: "Asked me to pay by bank transfer first" } })).status, 200);
  assert.equal((await say(sam, "still there?")).body.error, "conversation_closed");
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", lamp.body.id).status, "active", "back on sale");
  const reports = (await call("/relay/my/admin/reports", { token: admin.token })).body.reports;
  const rep = reports.find(r => r.kind === "conversation");
  assert.equal(rep.reason, "Asked me to pay by bank transfer first"); assert.equal(rep.reportedRole, "seller");
  assert.ok(!JSON.stringify(reports).includes("example.com"), "the team never sees who either member is");
  assert.equal((await call("/relay/my/admin/reports", { token: eve.token })).status, 404, "the review queue is the team's only");
  assert.equal((await call("/relay/my/admin/reports/" + rep.id + "/review", { method: "POST", token: admin.token, body: { outcome: "block" } })).status, 200);
  assert.equal((await say(sam, "hello?", beaReq)).body.error, "account_restricted", "a blocked member can't message");
  assert.equal((await ask(sam, scarf.body.id, { kind: "buy" })).body.error, "account_restricted", "or ask");
  assert.equal((await call("/relay/my/resale/listings", { method: "POST", token: sam.token, body: { receiptId: samShirt, itemIndex: 0, condition: "good", agree: true } })).body.error, "account_restricted", "or list");
  assert.ok(!(await feedOf(bea)).some(l => l.title === "Brass Desk Lamp" || l.title === "Ceramic Vase"), "their listings come down");
  assert.equal(one("SELECT status FROM resale_requests WHERE listing_id = ? AND asker_id = (SELECT id FROM shoppers WHERE email = ?)", vase.body.id, bea.email).status, "declined", "and what was asked of them is closed");
  // Unblocked again for the app part below (only the test can do this; there's no "unblock" in Relay).
  w.sqlite.exec("DELETE FROM resale_blocks");
  console.log("ok - reporting a conversation ends it and puts the item back; the team sees it without names and can block: a blocked member can't list, ask or message");

  // Deleting an account: their listings, requests and messages go, and someone else's item matched with them goes back on sale.
  const evePhoto = await call("/relay/my/resale/listings", { method: "POST", token: eve.token, body: { receiptId: eveBoots, itemIndex: 0, condition: "fair", agree: true, photos: [PNG] } });
  assert.equal(evePhoto.status, 200);
  assert.equal((await ask(eve, scarf.body.id, { kind: "buy" })).status, 200);
  const eveAsk = (await call("/relay/my/resale/mine", { token: bea.token })).body.listings.find(l => l.id === scarf.body.id).requests.find(q => q.status === "pending").id;
  assert.equal((await call("/relay/my/resale/requests/" + eveAsk + "/accept", { method: "POST", token: bea.token })).status, 200);
  assert.equal((await say(eve, "Thanks!", eveAsk)).status, 200);
  assert.equal((await say(bea, "You're welcome", eveAsk)).status, 200);
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", scarf.body.id).status, "matched");
  assert.equal((await call("/relay/my/delete", { method: "POST", token: eve.token, body: {} })).status, 200);
  const eveId = null;
  assert.equal(count("SELECT COUNT(*) FROM resale_listings WHERE id = ?", evePhoto.body.id), 0, "her listing is gone");
  assert.equal(count("SELECT COUNT(*) FROM resale_photos WHERE listing_id = ?", evePhoto.body.id), 0, "and its photo");
  assert.equal(count("SELECT COUNT(*) FROM resale_requests WHERE id = ?", eveAsk), 0, "her request is gone");
  assert.equal(count("SELECT COUNT(*) FROM resale_messages WHERE request_id = ?", eveAsk), 0, "and the conversation with her");
  assert.equal(count("SELECT COUNT(*) FROM shoppers WHERE email = ?", eve.email), 0);
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", scarf.body.id).status, "active", "Bea's scarf, matched with Eve, is back on sale");
  assert.ok((await feedOf(sam)).some(l => l.id === scarf.body.id), "and in Browse again");
  assert.equal((await call("/relay/my/resale/feed", { token: eve.token })).status, 401, "her session is gone");
  void eveId;
  console.log("ok - deleting an account removes their listings, photos, requests and conversations, and puts an item matched with them back on sale");

  // Clean slate for the app part: Sam's and Bea's listings taken down by them.
  for (const [who, id] of [[sam, lamp.body.id], [sam, vase.body.id], [bea, scarf.body.id]]) await call("/relay/my/resale/listings/" + id + "/withdraw", { method: "POST", token: who.token });
  assert.equal(count("SELECT COUNT(*) FROM resale_listings WHERE status = 'active'"), 0);

  // ---- Changing a listing, what's new (the red number and phone notifications), and a member's own block -------------
  const finn = await signUp("finn.fourth@example.com", "Finn Fourth");
  const samMug = await paste(sam, "Kiln Road", "Stoneware Mug", 1800, "KR-301");
  const samBag = await paste(sam, "Fennel", "Canvas Tote Bag", 2200, "FN-4410");
  const beaCap = await paste(bea, "Brindle and Co", "Corduroy Cap", 1600, "BC-207");
  const finnHat = await paste(finn, "Alpine Active", "Wool Beanie", 1500, "AA-91");
  const list = async (who, rid, b = {}) => (await call("/relay/my/resale/listings", { method: "POST", token: who.token, body: { receiptId: rid, itemIndex: 0, condition: "good", askPence: 1000, agree: true, handover: "post", ...b } })).body.id;
  const mug = await list(sam, samMug, { note: "Chip on the base" }), bag = await list(sam, samBag), cap = await list(bea, beaCap), hat = await list(finn, finnHat);
  const news = async who => (await call("/relay/my/resale/news", { token: who.token })).body;
  const row = id => one("SELECT * FROM resale_listings WHERE id = ?", id);
  const edit = (who, id, b) => call("/relay/my/resale/listings/" + id + "/edit", { method: "POST", token: who.token, body: b });

  // Editing: only the seller, only while it's on sale; never the title or shop.
  for (const who of [bea, finn]) assert.equal((await edit(who, mug, { askPence: 1 })).status, 404, "someone else's listing is 'not found'");
  assert.equal((await edit(sam, mug, { title: "Gold watch" })).status, 400, "the title can't be changed");
  assert.equal((await edit(sam, mug, { store: "Harrods" })).status, 400, "nor the shop");
  assert.equal((await edit(sam, mug, {})).body.error, "nothing_to_change");
  assert.equal((await edit(sam, mug, { askPence: -5 })).status, 400);
  assert.equal((await edit(sam, mug, { condition: "mint" })).body.error, "invalid_condition");
  assert.equal((await edit(sam, mug, { photos: [FAKE] })).status, 400, "a new photo is checked by its bytes too");
  assert.equal((await edit(sam, mug, { askPence: 1500, condition: "like_new", note: "No chips after all 🙂", photos: [PNG] })).status, 200);
  assert.deepEqual([row(mug).ask_pence, row(mug).condition, row(mug).note, row(mug).photos, row(mug).has_image, row(mug).title, row(mug).store], [1500, "like_new", "No chips after all 🙂", 1, 1, "Stoneware Mug", "Kiln Road"]);
  let seen = (await feedOf(bea)).find(l => l.id === mug);
  assert.deepEqual([seen.askPence, seen.condition, seen.note, seen.photos], [1500, "like_new", "No chips after all 🙂", 1], "Browse shows the change");
  assert.equal((await fetch(w.origin + "/relay/my/resale/listings/" + mug + "/photos/1", { headers: { authorization: "Bearer " + bea.token } })).status, 200, "the new photo is served");
  assert.equal((await edit(sam, mug, { offers: true })).status, 200); assert.equal(row(mug).ask_pence, null, "open to offers");
  assert.equal((await edit(sam, mug, { removePhotos: true, note: "" })).status, 200);
  assert.deepEqual([row(mug).photos, row(mug).has_image, row(mug).note], [0, 0, null], "photos and note taken away");
  assert.equal((await fetch(w.origin + "/relay/my/resale/listings/" + mug + "/photos/1", { headers: { authorization: "Bearer " + bea.token } })).status, 404);
  await edit(sam, mug, { askPence: 1200 });
  console.log("ok - server: only the seller can change a listing (price, offers, condition, note, photos), never its title or shop; others get 'not found'");

  // What's new: Bea and Finn ask about the mug. Sam gets a phone notification for each, and a count until Yours is opened.
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const SAM_PUSH = "https://fcm.googleapis.com/fcm/send/made-up-sam-device", BEA_PUSH = "https://fcm.googleapis.com/fcm/send/made-up-bea-device";
  for (const [who, endpoint] of [[sam, SAM_PUSH], [bea, BEA_PUSH]]) assert.equal((await call("/relay/my/push/subscribe", { method: "POST", token: who.token, body: { endpoint,
    keys: { p256dh: Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") } } })).status, 200);
  const pushed = endpoint => w.outside.filter(u => u === endpoint).length;
  assert.deepEqual(await news(sam), { requests: 0, messages: 0, total: 0, active: true });
  assert.deepEqual(await news(admin), { requests: 0, messages: 0, total: 0, active: false }, "nothing to wait for: the app stops asking");
  assert.equal((await ask(bea, mug, { kind: "buy", message: "Lovely mug" })).status, 200);
  assert.equal(pushed(SAM_PUSH), 1, "Sam's phone is told about the request");
  assert.equal((await ask(finn, mug, { kind: "buy" })).status, 200);
  assert.equal(pushed(SAM_PUSH), 2);
  assert.equal((await news(sam)).requests, 2, "two requests not seen yet");
  const beforeSeen = (await call("/relay/my/resale/mine", { token: sam.token })).body;
  assert.deepEqual(beforeSeen.listings.find(l => l.id === mug).requests.map(q => q.new), [true, true]);
  assert.equal((await news(sam)).requests, 2, "a quiet look (Browse's copy) doesn't count as seeing them");
  const opened = (await call("/relay/my/resale/mine?seen=1", { token: sam.token })).body;
  assert.deepEqual(opened.listings.find(l => l.id === mug).requests.map(q => q.new), [true, true], "opening Yours still says which were new");
  assert.equal(opened.news.requests, 0); assert.equal((await news(sam)).requests, 0, "and then they're seen");
  const mugReq = opened.listings.find(l => l.id === mug).requests[0].id;
  assert.equal((await call("/relay/my/resale/requests/" + mugReq + "/accept", { method: "POST", token: sam.token })).status, 200);
  assert.equal((await edit(sam, mug, { askPence: 1 })).body.error, "listing_matched", "not while matched with someone");

  // Messages: a count of unread ones for whoever they're for, and one notification per batch (not one per message).
  assert.equal((await say(bea, "Hello! When could I collect?", mugReq)).status, 200);
  assert.equal(pushed(SAM_PUSH), 3, "the first new message is notified");
  assert.equal((await say(bea, "Any evening works", mugReq)).status, 200);
  assert.equal(pushed(SAM_PUSH), 3, "the second, before Sam has read the first, isn't");
  assert.equal((await news(sam)).messages, 2); assert.equal((await news(bea)).messages, 0, "your own messages aren't new to you");
  assert.equal((await call("/relay/my/resale/mine", { token: sam.token })).body.listings.find(l => l.id === mug).requests[0].unread, 2);
  assert.equal((await msgs(sam, mugReq)).status, 200);
  assert.equal((await news(sam)).messages, 0, "reading the conversation clears it");
  assert.equal((await say(bea, "Thanks!", mugReq)).status, 200);
  assert.equal(pushed(SAM_PUSH), 4, "after reading, the next new message is notified again");
  assert.equal((await say(sam, "Tuesday at six?", mugReq)).status, 200);
  assert.equal(pushed(BEA_PUSH), 1, "and the buyer is told about the seller's reply");
  assert.equal((await news(bea)).messages, 1);
  assert.equal((await call("/relay/my/resale/mine", { token: bea.token })).body.myRequests.find(q => q.id === mugReq).unread, 1);
  assert.equal((await news(finn)).total, 0, "Finn, declined, has nothing new");
  console.log("ok - server: new requests and unread messages are counted until seen, and each sends one phone notification (no more per message until read)");

  // Sam blocks Bea from the conversation: it ends, neither sees the other's listings, and Bea can't ask about Sam's again.
  const reportsBefore = count("SELECT COUNT(*) FROM resale_reports") + count("SELECT COUNT(*) FROM resale_listing_reports");
  assert.equal((await call("/relay/my/resale/requests/" + mugReq + "/block", { method: "POST", token: finn.token })).status, 404, "only someone in it can block from it");
  assert.equal((await call("/relay/my/resale/requests/" + mugReq + "/block", { method: "POST", token: sam.token })).status, 200);
  assert.equal((await say(bea, "Hello?", mugReq)).body.error, "conversation_closed", "Bea can't message Sam");
  assert.equal((await say(sam, "Hello?", mugReq)).body.error, "conversation_closed");
  assert.equal(row(mug).status, "active", "the mug is back on sale");
  assert.ok(!(await feedOf(bea)).some(l => l.id === mug || l.id === bag), "Bea no longer sees Sam's listings");
  assert.ok(!(await feedOf(sam)).some(l => l.id === cap), "nor Sam Bea's");
  assert.ok((await feedOf(finn)).some(l => l.id === mug) && (await feedOf(finn)).some(l => l.id === cap), "everyone else still sees both");
  assert.equal((await ask(bea, bag, { kind: "buy" })).body.error, "not_found", "Bea can't ask about Sam's listings (and isn't told why)");
  assert.equal((await ask(sam, cap, { kind: "buy" })).body.error, "not_found");
  assert.equal(count("SELECT COUNT(*) FROM resale_reports") + count("SELECT COUNT(*) FROM resale_listing_reports"), reportsBefore, "a block isn't a report");
  assert.equal(count("SELECT COUNT(*) FROM resale_blocks"), 0, "nor the team's block");
  const blocks = (await call("/relay/my/resale/blocks", { token: sam.token })).body.blocks;
  assert.deepEqual(blocks.map(b => b.about), ["Stoneware Mug"]);
  const beaId = one("SELECT id FROM shoppers WHERE email = ?", bea.email).id;
  assert.ok(!JSON.stringify(blocks).includes(beaId) && !/bea/i.test(JSON.stringify(blocks)), "Sam never learns who it was");
  assert.deepEqual((await call("/relay/my/resale/blocks", { token: bea.token })).body.blocks, [], "Bea isn't told she's blocked");
  assert.equal((await call("/relay/my/resale/blocks/" + blocks[0].id + "/remove", { method: "POST", token: bea.token })).status, 404, "only the blocker can unblock");
  assert.deepEqual((await call("/relay/my/export", { token: sam.token })).body.swapAndSell.membersYouBlocked.map(b => b.about), ["Stoneware Mug"], "in Download my data");
  assert.equal((await call("/relay/my/resale/blocks/" + blocks[0].id + "/remove", { method: "POST", token: sam.token })).status, 200);
  assert.ok((await feedOf(bea)).some(l => l.id === bag), "unblocked: Bea sees Sam's listings again");
  assert.equal((await ask(bea, bag, { kind: "buy" })).status, 200, "and can ask");
  console.log("ok - server: a member blocks another from a conversation: it ends, neither sees or asks about the other's listings, no report is made, and only the blocker sees it (by item) and can unblock");

  // Free chats (Connor, 24 Nov): Gus and Hana each message Sam about one lamp before asking for it, in their own
  // conversations. Sam matches it with Gus; Hana's chat stays readable, says the item has gone, and takes no more messages.
  const gus = await signUp("gus.fifth@example.com", "Gus Fifth"), hana = await signUp("hana.sixth@example.com", "Hana Sixth");
  const lampR = await paste(sam, "Larkspur Home", "Reading Lamp", 3000, "LK-77");
  const rl = await list(sam, lampR);
  const chat = async who => (await call("/relay/my/resale/listings/" + rl + "/chat", { method: "POST", token: who.token })).body;
  assert.equal((await chat(sam)).error, "own_listing");
  const before = await news(sam);
  const g = (await chat(gus)).requestId, h = (await chat(hana)).requestId;
  assert.ok(g && h && g !== h, "each member has their own conversation");
  assert.equal((await chat(gus)).requestId, g, "opening it again is the same conversation");
  assert.deepEqual((await call("/relay/my/resale/mine", { token: sam.token })).body.listings.find(l => l.id === rl).requests, [], "a chat nobody has written in isn't shown to the seller");
  assert.equal((await say(gus, "Does it come with a bulb?", g)).status, 200, "Gus messages before asking for it");
  assert.equal((await say(hana, "Is the shade glass?", h)).status, 200, "and so does Hana, at the same time");
  assert.equal((await say(gus, "mail me gus.fifth@example.com", g)).body.error, "no_contact_details", "contact details are still refused");
  assert.equal((await msgs(hana, g)).status, 404, "Hana can't read Gus's conversation");
  assert.equal((await say(hana, "me too", g)).status, 404, "or write in it");
  assert.equal((await call("/relay/my/resale/requests/" + g + "/block", { method: "POST", token: hana.token })).status, 404);
  let lampMine = (await call("/relay/my/resale/mine", { token: sam.token })).body;
  assert.deepEqual(lampMine.listings.find(l => l.id === rl).requests.map(q => [q.who, q.kind, q.new, q.unread]), [["Member 1", "chat", false, 1], ["Member 2", "chat", false, 1]]);
  assert.deepEqual([lampMine.news.requests, (await news(sam)).messages], [before.requests, before.messages + 2], "chats count as messages, not requests");
  assert.equal((await say(sam, "Yes, a warm white one", g)).status, 200);
  assert.equal((await say(sam, "It's fabric", h)).status, 200);
  assert.deepEqual((await msgs(gus, g)).body.messages.map(m => m.body), ["Does it come with a bulb?", "Yes, a warm white one"], "Gus sees only his own conversation");
  assert.deepEqual((await msgs(hana, h)).body.messages.map(m => m.body), ["Is the shade glass?", "It's fabric"]);
  assert.equal((await call("/relay/my/resale/requests/" + g + "/accept", { method: "POST", token: sam.token })).body.error, "not_asked_yet", "a chat on its own can't be matched");
  assert.equal((await ask(gus, rl, { kind: "buy" })).status, 200, "Gus asks for it");
  lampMine = (await call("/relay/my/resale/mine", { token: sam.token })).body;
  const gReq = lampMine.listings.find(l => l.id === rl).requests.find(q => q.id === g);
  assert.deepEqual([gReq.kind, gReq.new], ["buy", true], "his chat became his request: the same conversation carries on");
  assert.equal((await call("/relay/my/resale/requests/" + g + "/accept", { method: "POST", token: sam.token })).status, 200);
  const hanaThread = (await msgs(hana, h)).body;
  assert.deepEqual([hanaThread.open, hanaThread.itemGone, hanaThread.messages.length], [false, true, 2], "Hana's chat stays readable and says the item has gone");
  assert.equal((await say(hana, "Is it still there?", h)).body.error, "item_gone", "and takes no more messages");
  assert.equal((await say(sam, "Sorry!", h)).body.error, "item_gone", "from either side");
  assert.equal((await call("/relay/my/resale/mine", { token: hana.token })).body.myRequests.find(q => q.id === h).itemGone, true);
  assert.equal((await say(gus, "Brilliant, thank you", g)).status, 200, "Gus, matched, carries on");
  assert.equal((await chat(hana)).error, "not_found", "no new chat about an item that has gone");
  // A member the seller blocked can't start a chat about their other listings (as if they weren't there).
  const otherR = await paste(sam, "Larkspur Home", "Linen Cushion", 1200, "LK-78");
  const cushion = await list(sam, otherR);
  assert.equal((await call("/relay/my/resale/requests/" + h + "/block", { method: "POST", token: sam.token })).status, 200);
  assert.equal((await call("/relay/my/resale/listings/" + cushion + "/chat", { method: "POST", token: hana.token })).body.error, "not_found", "blocked: no chat");
  assert.equal((await call("/relay/my/resale/listings/" + cushion + "/chat", { method: "POST", token: gus.token })).status, 200, "others still can");
  for (const id of [rl, cushion]) await call("/relay/my/resale/listings/" + id + "/withdraw", { method: "POST", token: sam.token });
  w.sqlite.exec("DELETE FROM resale_member_blocks");
  console.log("ok - server: free chats: two members message the seller about one listing before asking, each only in their own; matching it to one leaves the other readable, saying the item has gone, with no more messages");

  // Finn blocks Sam, then deletes his account: his blocks and what he'd read go with it.
  const finnReq = (await call("/relay/my/resale/mine", { token: sam.token })).body.listings.find(l => l.id === mug).requests.find(q => q.who === "Member 2").id;
  assert.equal((await call("/relay/my/resale/requests/" + finnReq + "/block", { method: "POST", token: finn.token })).status, 200);
  const finnId = one("SELECT id FROM shoppers WHERE email = ?", finn.email).id;
  assert.equal((await call("/relay/my/delete", { method: "POST", token: finn.token, body: {} })).status, 200);
  assert.equal(count("SELECT COUNT(*) FROM resale_member_blocks WHERE blocker_id = ? OR blocked_id = ?", finnId, finnId), 0, "his blocks are gone");
  assert.equal(count("SELECT COUNT(*) FROM resale_reads WHERE shopper_id = ?", finnId), 0);
  void hat;
  for (const [who, id] of [[sam, mug], [sam, bag], [bea, cap]]) await call("/relay/my/resale/listings/" + id + "/withdraw", { method: "POST", token: who.token });
  assert.equal(count("SELECT COUNT(*) FROM resale_listings WHERE status = 'active'"), 0);
}

if (process.argv.includes("--api-only")) { await w.close(); app.close(); console.log("PASS marketplace (server part only)"); process.exit(0); }

// ---- 2. In the app: three people, each in their own browser -----------------------------------------------------------
const browser = await chromium.launch();
const errorsOf = new Map();
async function phone(who, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: true });
  await skipInterests(ctx);
  const asked = [];
  // The app's requests to Relay's address go to the local server, unchanged. Anything else outside this computer is refused.
  await ctx.route(/^https?:\/\//, async route => {
    const req = route.request(), url = req.url();
    if (url.startsWith(APP)) return route.continue();
    if (!url.startsWith(LIVE_API)) return route.abort();
    const path = url.slice(LIVE_API.length);
    asked.push({ method: req.method(), path: path.split("?")[0], at: Date.now() });
    const headers = { ...req.headers() }; delete headers.host;
    // Agreeing to Relay's terms takes a moment here, so the button's working state can be seen.
    if (req.method() === "POST" && path === "/relay/my/consent") await new Promise(r => setTimeout(r, 700));
    const r = await fetch(w.origin + path, { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() });
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    asked[asked.length - 1].status = r.status;
    if (r.status >= 400) asked[asked.length - 1].answer = await r.clone().text();
    return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
  });
  const page = await ctx.newPage();
  const errs = []; errorsOf.set(who.email, errs);
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(APP + "/index.html");
  await page.evaluate(s => localStorage.setItem("relay.session.v1", JSON.stringify({ token: s.token, email: s.email, expiresAt: Date.now() + 864e5 })), who);
  await page.reload();
  await page.locator("#foot button").first().waitFor();
  return { page, ctx, asked, who };
}
// (A test's double clicks select text, which a phone's double tap doesn't: cleared before each picture.)
const shot = async (p, name) => { await p.page.evaluate(() => { try { getSelection().removeAllRanges(); } catch (e) {} }); return p.page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
async function openMarket(p) {
  await goTab(p.page, "Browse");
  await p.page.locator("#browsePage .rl-b2-doors .rl-arow", { hasText: "Swap & resell" }).click();
  await p.page.getByRole("heading", { name: "Swap & resell" }).waitFor();
  const sheet = p.page.locator("#dcAlt");
  // A new member is asked for Relay's OK to use their receipts first (the real consent, agreed in the app).
  await sheet.locator(".rl-mk-tabs, .rl-btn:text('Review and agree')").first().waitFor();
  if (await sheet.getByRole("button", { name: "Review and agree" }).count()) {
    await sheet.getByRole("button", { name: "Review and agree" }).click();
    const agree = p.page.getByRole("button", { name: "I agree and continue" });
    await agree.click();
    // While it's saved: the button is pressed in and working, and can't be pressed again; no bare "Saving…" (rule 7).
    assert.deepEqual(await agree.evaluate(b => [b.disabled, b.classList.contains("rl-working"), /Saving/.test(b.closest(".rl-sheet").innerText)]), [true, true, false], "the button shows it's working, with no bare Saving…");
    await agree.waitFor({ state: "detached" });
    assert.ok(one("SELECT 1 AS x FROM shopper_consents c JOIN shoppers s ON s.id = c.shopper_id WHERE s.email = ?", p.who.email), "the OK is kept by Relay");
    // Agreeing comes straight back to Swap & resell, not the account sheet.
    await sheet.locator(".rl-mk-tabs").waitFor();
    assert.equal(await p.page.locator(".rl-back").count(), 0, "no account sheet in the way");
  }
  await sheet.locator(".rl-mk-tabs").waitFor();
  return sheet;
}
const mk = p => p.page.locator("#dcAlt");
// A listing's card (one tap, no buttons on it), and the sheet a tap opens.
const cardOf = (sheet, text) => sheet.locator(".rl-mk-card2", { hasText: text });
const layer = p => p.page.locator(".rl-mk-layer .rl-sheet").last();
const tabBadge = p => p.page.locator('#foot [data-tab="discover"] .tab-badge');
async function closeLayers(p) { await p.page.evaluate(() => document.querySelectorAll(".rl-mk-layer").forEach(l => l.remove())); }
async function noButtonsOnCards(sheet) { assert.equal(await sheet.locator(".rl-mk-card2 button, .rl-mk-card2 select, .rl-mk-tapcard button").count(), 0, "no buttons on a card (rule 16)"); }
const part = async (p, name) => { await waitOutDoubleTap(p.page); await mk(p).locator(".rl-mk-tabs").getByRole("button", { name: new RegExp("^" + name + "(, \\d+ new)?$") }).click(); };
const S = await phone(sam), B = await phone(bea);

// Sam lists the overshirt: a photo, a price, a condition, collection or post in SW11.
{
  const sheet = await openMarket(S);
  await part(S, "Sell");
  const card = sheet.locator(".rl-order", { hasText: "Linen Overshirt" });
  await card.getByRole("button", { name: "List this" }).click();
  await card.getByLabel("Condition", { exact: true }).selectOption("good");
  await card.getByLabel("Size", { exact: true }).fill("M");
  await card.getByLabel("Asking price in £", { exact: true }).fill("30");
  await card.getByLabel("Note for buyers", { exact: true }).fill("Worn twice, no marks ✨");
  await card.getByLabel("Handover", { exact: true }).selectOption("either");
  await card.getByLabel("Postcode area for collection", { exact: true }).fill("SW11");
  const PIC = await S.page.evaluate(() => { const c = document.createElement("canvas"); c.width = 900; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#4a6fa5"; g.fillRect(0, 0, 900, 1200); g.fillStyle = "#e8dcc8"; g.fillRect(200, 250, 500, 700); return c.toDataURL("image/png").split(",")[1]; });
  await card.locator('input[type="file"]').setInputFiles([{ name: "shirt.png", mimeType: "image/png", buffer: Buffer.from(PIC, "base64") }]);
  await card.locator(".rl-mk-thumb").first().waitFor();
  await card.getByLabel(/I agree Relay shows this item's name/).check();
  await shot(S, "01-sam-lists-item");
  await card.getByRole("button", { name: "Put it on Relay" }).dblclick();
  await sheet.getByText("Listed. Other members can now see it.").waitFor();
  const rows = w.sqlite.prepare("SELECT * FROM resale_listings WHERE status = 'active'").all();
  assert.equal(rows.length, 1, "listed once for a double tap");
  assert.deepEqual([rows[0].title, rows[0].ask_pence, rows[0].condition, rows[0].size, rows[0].handover, rows[0].area, rows[0].photos, rows[0].note],
    ["Linen Overshirt", 3000, "good", "M", "either", "SW11", 1, "Worn twice, no marks ✨"]);
  assert.equal(one("SELECT type FROM resale_photos WHERE listing_id = ?", rows[0].id).type, "image/jpeg", "the photo, made smaller on the phone, kept as a JPEG");
  await cardOf(sheet, "Linen Overshirt").waitFor();
  await shot(S, "02-sam-yours-after-listing");
  console.log("ok - app: Sam lists an item with a photo, price, condition and handover; a double tap lists it once");
}

// Bea finds it in Browse, with Sam's photo, and asks for it. A double tap asks once.
let requestId;
{
  const sheet = await openMarket(B);
  const card = cardOf(sheet, "Linen Overshirt");
  await card.waitFor();
  assert.match(await card.innerText(), /Linen Overshirt\s+£30\.00\s+Fennel, size M\s+Good\s+Collect in SW11 or post/);
  assert.ok(!/Sam|sam\.seller/.test(await sheet.innerText()), "never who's selling");
  await B.page.waitForFunction(() => { const i = document.querySelector("#dcAlt .rl-mk-card2 img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  assert.deepEqual(await card.locator(".rl-mk-pic").evaluate(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]), [140, 140], "a 140px square picture");
  await noButtonsOnCards(sheet);
  await shot(B, "03-bea-browse-finds-item");
  // One tap opens its sheet, with what she can do.
  await card.click();
  const ls = layer(B);
  await ls.getByRole("heading", { name: "Linen Overshirt" }).waitFor();
  assert.equal(await ls.locator(".rl-navback[data-back]").count(), 1, "the sheet's Back is the drawn chevron");
  await shot(B, "03b-bea-listing-sheet");
  await ls.getByRole("button", { name: "I'd like this" }).dblclick();
  await sheet.getByText("Sent. The seller sees your request from “Member”, not your name.").waitFor();
  await cardOf(sheet, "Linen Overshirt").getByText("You asked about this: waiting for the seller.").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_requests"), count("SELECT COUNT(*) FROM resale_requests WHERE status != 'pending'") + 1, "asked once");
  assert.equal(B.asked.filter(a => a.method === "POST" && /\/ask$/.test(a.path)).length, 1, "one request sent for a double tap");
  requestId = one("SELECT id FROM resale_requests WHERE status = 'pending'").id;
  console.log("ok - app: Bea finds Sam's item in Browse with its photo and no name, and asks once for a double tap");
}

// Sam opens Relay: a red number on Browse says something is new (asked once, on opening, because Sam has used Swap &
// resell on this phone). It's on Yours and the card too, and opening Yours clears it.
let samChat;
{
  const openedAt = S.asked.length;
  await S.page.reload(); await S.page.locator("#foot button").first().waitFor();
  await tabBadge(S).waitFor({ timeout: 10000 });
  assert.equal(await tabBadge(S).innerText(), "1", "a red 1 on Browse");
  assert.match(await S.page.locator('#foot [data-tab="discover"]').getAttribute("aria-label"), /1 new in Swap & resell/);
  assert.equal(S.asked.slice(openedAt).filter(a => a.path === "/relay/my/resale/news").length, 1, "asked once on opening");
  await shot(S, "04a-sam-red-number-on-browse");
  const sheet = await openMarket(S);
  await sheet.locator('.rl-mk-tabs [data-tab="mine"] .rl-mk-count', { hasText: "1" }).waitFor();
  await part(S, "Yours");
  const card = cardOf(sheet, "Linen Overshirt");
  await card.getByText("New request").waitFor({ timeout: 10000 });
  await card.locator(".rl-mk-count", { hasText: "1" }).waitFor();
  await noButtonsOnCards(sheet);
  await shot(S, "04b-sam-yours-new-request");
  await tabBadge(S).waitFor({ state: "detached" });
  assert.equal(await sheet.locator('.rl-mk-tabs [data-tab="mine"] .rl-mk-count').count(), 0, "seen: the red numbers go");
  await card.click();
  const ls = layer(S);
  await ls.getByText("Member 1 would like to buy").waitFor();
  await ls.getByRole("button", { name: "Accept" }).dblclick();
  await layer(S).getByRole("button", { name: "Open messages" }).waitFor();
  assert.equal(S.asked.filter(a => a.method === "POST" && /\/accept$/.test(a.path)).length, 1, "accepted once for a double tap");
  assert.equal(one("SELECT status FROM resale_listings WHERE title = 'Linen Overshirt'").status, "matched");
  await shot(S, "04-sam-accepts");
  await layer(S).getByRole("button", { name: "Open messages" }).click();
  await sheet.getByText("No messages yet. Say hello and agree how this will work.").waitFor();
  samChat = sheet;
  await sheet.getByPlaceholder("Write a message").fill("Hi! 👋 It's yours. Could you collect on Saturday?");
  await sheet.getByRole("button", { name: "Send", exact: true }).dblclick();
  await sheet.getByText("Hi! 👋 It's yours. Could you collect on Saturday?").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_messages WHERE request_id = ?", requestId), 1, "sent once for a double tap");
  console.log("ok - app: Sam sees the request as Member 1, accepts once, and messages Bea (emoji, a double tap sends once)");
}

// Bea opens the conversation from Yours, sees Sam's message and replies; Enter twice sends once.
let beaChat;
{
  // Sam's message is new for Bea: a red number on Browse when she opens Relay, on her request, gone once she reads it.
  await B.page.reload(); await B.page.locator("#foot button").first().waitFor();
  await tabBadge(B).waitFor({ timeout: 10000 });
  assert.equal(await tabBadge(B).innerText(), "1");
  const sheet = await openMarket(B);
  await part(B, "Yours");
  await sheet.getByText("You'd like to buy it. Accepted.").waitFor({ timeout: 10000 });
  const asked = sheet.locator(".rl-mk-tapcard", { hasText: "Linen Overshirt" });
  await asked.locator(".rl-mk-count", { hasText: "1" }).waitFor();
  await noButtonsOnCards(sheet);
  await shot(B, "04c-bea-new-message");
  await asked.click();
  await sheet.getByText("Hi! 👋 It's yours. Could you collect on Saturday?").waitFor();
  await tabBadge(B).waitFor({ state: "detached" });
  // The conversation's Back: a drawn chevron and a word in the accent blue, at the top, used by the phone's back.
  const nb = sheet.locator(".rl-navback[data-back]").first();
  assert.deepEqual(await nb.evaluate(b => [b.innerText.trim(), getComputedStyle(b).color, !!b.querySelector("svg"), b.getBoundingClientRect().top < 200]), ["Swap & resell", "rgb(43, 89, 195)", true, true]);
  beaChat = sheet;
  const box = sheet.getByPlaceholder("Write a message");
  const long = "Saturday morning works for me, I can come to SW11 around ten if that suits, and I'll bring cash. ".repeat(5).trim().slice(0, 480) + " 🙂👍🏽";
  await box.fill(long);
  const sentBefore = B.asked.filter(a => a.method === "POST" && /\/messages$/.test(a.path)).length;
  // Enter twice, the second before Relay has answered the first (as a quick thumb on a phone's Send key does).
  await box.evaluate(i => { for (let k = 0; k < 2; k++) i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await sheet.locator(".rl-mk-bubble.mine", { hasText: long }).first().waitFor();
  await B.page.waitForTimeout(800);
  assert.equal(await sheet.locator(".rl-mk-bubble", { hasText: long }).count(), 1, "shown once");
  assert.equal(count("SELECT COUNT(*) FROM resale_messages WHERE request_id = ?", requestId), 2, "Enter pressed twice sends once");
  assert.equal(B.asked.filter(a => a.method === "POST" && /\/messages$/.test(a.path)).length - sentBefore, 1, "and only one was sent");
  assert.equal(one("SELECT body FROM resale_messages WHERE request_id = ? ORDER BY created_at DESC, rowid DESC", requestId).body, long, "long text and emoji kept whole");
  await box.fill("Is it a slim fit? my email is bea.buyer@example.com");
  await box.press("Enter");
  await sheet.getByText("Please keep emails, phone numbers and links out of messages for now.").waitFor();
  assert.equal(await box.inputValue(), "Is it a slim fit? my email is bea.buyer@example.com", "what she wrote stays to fix");
  await box.fill("");
  await shot(B, "05-bea-chat");
  console.log("ok - app: Bea opens the conversation, replies with long text and emoji; Enter twice sends once; contact details refused in plain words");
}

// Both conversations are open: each sees the other's new message without doing anything (asked every 30 seconds, only
// while the conversation is on screen and Relay is in front).
{
  const before = S.asked.length;
  await beaChat.getByPlaceholder("Write a message").fill("See you Saturday!");
  await beaChat.getByRole("button", { name: "Send", exact: true }).click();
  await samChat.getByText("See you Saturday!").waitFor({ timeout: 40000 });
  const polls = S.asked.slice(before).filter(a => /\/messages$/.test(a.path));
  assert.ok(polls.length >= 1 && polls.length <= 2, "Sam's open conversation asked " + polls.length + " times");
  await shot(S, "06-sam-sees-reply-live");
  // Relay in the background: nothing is asked.
  await S.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const hiddenAt = S.asked.length;
  await S.page.waitForTimeout(32000);
  assert.deepEqual(S.asked.slice(hiddenAt).map(a => a.path), [], "nothing asked while Relay is in the background");
  // Back in front: asks straight away, once.
  await S.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await S.page.waitForTimeout(800);
  assert.deepEqual(S.asked.slice(hiddenAt).map(a => a.path), ["/relay/my/resale/requests/" + requestId + "/messages"], "asks once on coming back");
  // Conversation closed (Back): nothing more is asked about it.
  await samChat.getByRole("button", { name: "Back" }).click();
  await samChat.locator(".rl-mk-tabs").waitFor();
  const closedAt = S.asked.length;
  await S.page.waitForTimeout(32000);
  assert.deepEqual(S.asked.slice(closedAt).filter(a => /\/messages$/.test(a.path)), [], "nothing asked once the conversation is closed");
  assert.deepEqual(S.asked.slice(closedAt).map(a => a.path), [], "and nothing else on a timer either");
  console.log("ok - app: a new message arrives in the open conversation within 30 seconds; nothing is asked in the background or once it's closed");
}

// The matched item is gone from Browse for everyone else.
const E = await phone(await signUp("erin.third@example.com", "Erin Third"));
{
  const sheet = await openMarket(E);
  await sheet.locator(".rl-empty, .rl-mk-card2").first().waitFor();
  assert.equal(await cardOf(sheet, "Linen Overshirt").count(), 0, "matched, so not on sale");
  await sheet.getByText("Nothing listed yet").waitFor();
  await shot(E, "07-erin-browse-empty-says-what-to-do");
  console.log("ok - app: the matched item is gone from Browse for someone else, who's told what to do instead of an empty screen");
}

// The polish rules inside the conversation: taps at least 44px tall, no text under 13px, no sideways scroll, with the
// keyboard up the message box stays in view, and bigger text stays on the page.
{
  const page = B.page;
  const check = () => page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none"; };
    const out = { small: [], tiny: [], wide: document.documentElement.scrollWidth > innerWidth + 1, spills: [] };
    const root = document.querySelector("#dcAlt");
    for (const b of root.querySelectorAll("button, input, summary")) if (vis(b) && b.getBoundingClientRect().height < 43.5) out.small.push((b.innerText || b.placeholder || "").trim().slice(0, 30) + " " + Math.round(b.getBoundingClientRect().height));
    for (const e of root.querySelectorAll("*")) { if (!vis(e) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; const px = parseFloat(getComputedStyle(e).fontSize); if (px < 13) out.tiny.push(e.textContent.trim().slice(0, 30) + " " + px); }
    const log = [...root.querySelectorAll("div")].find(d => getComputedStyle(d).overflowY === "auto" && d.children.length);
    if (log) for (const m of log.children) if (m.getBoundingClientRect().right > log.getBoundingClientRect().right + 0.5) out.spills.push(m.textContent.slice(0, 20));
    return out;
  });
  assert.deepEqual(await check(), { small: [], tiny: [], wide: false, spills: [] }, "the conversation passes the polish rules");
  // The keyboard takes the bottom half of the screen: the message box and Send stay in view once it's tapped.
  await page.setViewportSize({ width: 390, height: 420 });
  const box = beaChat.getByPlaceholder("Write a message");
  await box.tap();
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => { const i = document.querySelector("#dcAlt input[placeholder='Write a message']"), s = [...document.querySelectorAll("#dcAlt button")].find(b => b.textContent === "Send"); const vh = (visualViewport && visualViewport.height) || innerHeight;
    return [i, s].map(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh + 0.5; }); });
  assert.deepEqual(seen, [true, true], "the message box and Send are in view with the keyboard up");
  await shot(B, "08-bea-chat-keyboard-up");
  await page.setViewportSize({ width: 390, height: 844 });
  // Bigger text: everything 30% larger stays on the page and inside the conversation.
  await page.evaluate(() => { for (const e of document.querySelectorAll("#dcAlt *")) { const c = getComputedStyle(e); e.style.fontSize = parseFloat(c.fontSize) * 1.3 + "px"; } });
  await page.waitForTimeout(300);
  const big = await check();
  assert.deepEqual({ wide: big.wide, spills: big.spills }, { wide: false, spills: [] }, "bigger text stays on the page");
  await shot(B, "09-bea-chat-bigger-text");
  await page.evaluate(() => { for (const e of document.querySelectorAll("#dcAlt *")) e.style.fontSize = ""; });
  console.log("ok - app: the conversation has 44px taps and readable text, keeps the message box above the keyboard, and survives bigger text");
}

// Bea reports the conversation: it ends for both, the item goes back on sale and shows in Browse again.
{
  await beaChat.getByRole("button", { name: "Report a problem" }).click();
  const dlg = B.page.getByRole("alertdialog");
  await dlg.locator("textarea").fill("They asked me to pay by bank transfer before I'd seen it 😕");
  await dlg.getByRole("button", { name: "Send report" }).dblclick();
  await beaChat.getByText("This conversation has ended.").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_reports WHERE request_id = ?", requestId), 1, "reported once");
  assert.equal(await beaChat.getByPlaceholder("Write a message").isVisible(), false, "no more messages");
  assert.equal(one("SELECT status FROM resale_listings WHERE title = 'Linen Overshirt' AND status != 'withdrawn'").status, "active", "back on sale");
  await shot(B, "10-bea-reported");
  const sheet = await openMarket(E);
  await cardOf(sheet, "Linen Overshirt").waitFor({ timeout: 10000 });
  // Relay's team sees the report in Profile's Review reports, without who either member is.
  const rep = (await call("/relay/my/admin/reports", { token: admin.token })).body.reports.find(r => r.kind === "conversation" && /bank transfer before/.test(r.reason));
  assert.ok(rep && rep.messages.length === 3 && !JSON.stringify(rep).includes("example.com"));
  console.log("ok - app: Bea reports the conversation once; it ends, the item is back in Browse, and Relay's team has it without names");
}

// Erin finds Sam's overshirt by searching Browse (members' listings are in its search), and a tap opens it.
{
  await E.page.evaluate(() => window.go("discover"));
  const q = E.page.locator("#browseQuery"); await q.waitFor();
  await q.fill("overshirt");
  const hit = E.page.locator("#browseSuggest [data-bs-mk]", { hasText: "Linen Overshirt" });
  await hit.waitFor({ timeout: 10000 });
  await E.page.locator("#browseSuggest h2", { hasText: "From members" }).waitFor();
  assert.match(await hit.innerText(), /Linen Overshirt\s+From a member, first bought at Fennel\s+£30\.00/);
  await shot(E, "11-erin-search-finds-member-listing");
  await hit.click();
  await layer(E).getByRole("heading", { name: "Linen Overshirt" }).waitFor({ timeout: 10000 });
  await layer(E).getByRole("button", { name: "I'd like this" }).waitFor();
  await E.page.keyboard.press("Escape");
  // Sam's own search never shows his own listing.
  await S.page.evaluate(() => window.go("discover"));
  await S.page.locator("#browseQuery").fill("overshirt");
  await S.page.waitForTimeout(1200);
  assert.equal(await S.page.locator("#browseSuggest [data-bs-mk]").count(), 0, "not your own");
  await S.page.locator("#browseQuery").fill("");
  console.log("ok - app: Browse's search finds members' listings (never your own), and a tap opens the listing");
}

// Sam changes the listing's price, condition, note and photo; Browse shows the change. Then he takes it down.
{
  const sheet = await openMarket(S);
  await part(S, "Yours");
  const card = cardOf(sheet, "Linen Overshirt");
  await card.click();
  await layer(S).getByRole("button", { name: "Change details" }).click();
  const f = layer(S);
  await f.getByRole("heading", { name: "Change details" }).waitFor();
  assert.equal(await f.getByLabel("Asking price in £", { exact: true }).inputValue(), "30");
  await f.getByLabel("Asking price in £", { exact: true }).fill("25");
  await f.getByLabel("Condition", { exact: true }).selectOption("fair");
  await f.getByLabel("Note for buyers", { exact: true }).fill("Small mark on the cuff");
  const PIC2 = await S.page.evaluate(() => { const c = document.createElement("canvas"); c.width = 800; c.height = 800; const g = c.getContext("2d"); g.fillStyle = "#c97b4a"; g.fillRect(0, 0, 800, 800); return c.toDataURL("image/png").split(",")[1]; });
  await f.locator('input[type="file"]').setInputFiles([{ name: "shirt2.png", mimeType: "image/png", buffer: Buffer.from(PIC2, "base64") }]);
  await f.locator(".rl-mk-thumb").first().waitFor();
  await shot(S, "12-sam-changes-details");
  const before = S.asked.filter(a => /\/edit$/.test(a.path)).length;
  await f.getByRole("button", { name: "Save changes" }).dblclick();
  await sheet.getByText("Saved. Members see the new details now.").waitFor();
  assert.equal(S.asked.filter(a => /\/edit$/.test(a.path)).length - before, 1, "saved once for a double tap");
  const r = one("SELECT * FROM resale_listings WHERE title = 'Linen Overshirt' AND status = 'active'");
  assert.deepEqual([r.ask_pence, r.condition, r.note, r.photos], [2500, "fair", "Small mark on the cuff", 1]);
  const es = await openMarket(E);
  await cardOf(es, "Linen Overshirt").getByText("£25.00").waitFor({ timeout: 10000 });
  assert.match(await cardOf(es, "Linen Overshirt").innerText(), /Fair/);
  console.log("ok - app: Sam changes the price, condition, note and photo once for a double tap, and Browse shows it");
  await openMarket(S); await part(S, "Yours");
  await cardOf(sheet, "Linen Overshirt").click();
  await layer(S).getByRole("button", { name: "Take this down" }).click();
  await S.page.getByRole("alertdialog").getByRole("button", { name: "Take it down" }).click();
  await sheet.getByText("Taken down.").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_listings WHERE status = 'active'"), 0);
  const e = await openMarket(E);
  await e.getByText("Nothing listed yet").waitFor({ timeout: 10000 });
  console.log("ok - app: Sam takes the listing down and it leaves Browse");
}

// Free chats in the app (Connor, 24 Nov): Erin messages Sam about a board before asking for it, while Bea, another buyer,
// chats with him in her own conversation and asks for it. Sam sees both in the listing's sheet and replies, then matches it
// with Bea: Erin's open conversation says plainly the item has gone, keeps what was said, and takes no more messages.
{
  const boardR = await paste(sam, "Larkspur Home", "Oak Chopping Board", 2800, "LK-90");
  const board = (await call("/relay/my/resale/listings", { method: "POST", token: sam.token, body: { receiptId: boardR, itemIndex: 0, condition: "like_new", askPence: 1500, agree: true, handover: "post" } })).body.id;
  const es = await openMarket(E);
  await cardOf(es, "Oak Chopping Board").click();
  await layer(E).getByRole("button", { name: "Message the seller" }).dblclick();
  await es.getByRole("heading", { name: "Oak Chopping Board" }).waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_requests WHERE listing_id = ?", board), 1, "one conversation for a double tap");
  await es.getByPlaceholder("Write a message").fill("Hi! Has it been oiled?");
  await es.getByRole("button", { name: "Send", exact: true }).click();
  await es.locator(".rl-mk-bubble.mine", { hasText: "Has it been oiled?" }).waitFor();
  await shot(E, "15-erin-messages-before-asking");
  const bChat = (await call("/relay/my/resale/listings/" + board + "/chat", { method: "POST", token: bea.token })).body.requestId;
  assert.equal((await call("/relay/my/resale/requests/" + bChat + "/messages", { method: "POST", token: bea.token, body: { body: "Would you post it?" } })).status, 200);
  assert.equal((await call("/relay/my/resale/listings/" + board + "/ask", { method: "POST", token: bea.token, body: { kind: "buy" } })).status, 200);
  const ss = await openMarket(S);
  await part(S, "Yours");
  await cardOf(ss, "Oak Chopping Board").click();
  const L = layer(S);
  const erinRow = L.locator(".rl-mk-req", { hasText: "Member 1 sent you a message" }), beaRow = L.locator(".rl-mk-req", { hasText: "Member 2 would like to buy" });
  await erinRow.waitFor(); await beaRow.waitFor();
  assert.equal(await erinRow.getByRole("button", { name: "Accept" }).count(), 0, "a chat on its own can't be accepted");
  await shot(S, "16-sam-two-buyers-chatting");
  await erinRow.getByRole("button", { name: /Open messages/ }).click();
  await ss.getByText("Hi! Has it been oiled?").waitFor();
  assert.equal(await ss.getByText("Would you post it?").count(), 0, "only Erin's conversation");
  await ss.getByPlaceholder("Write a message").fill("Yes, last week");
  await ss.getByRole("button", { name: "Send", exact: true }).click();
  await ss.locator(".rl-mk-bubble.mine", { hasText: "Yes, last week" }).waitFor();
  await ss.getByRole("button", { name: "Back to Swap & resell" }).click();
  await ss.locator(".rl-mk-tabs").waitFor();
  await cardOf(ss, "Oak Chopping Board").click();
  await layer(S).locator(".rl-mk-req", { hasText: "Member 2 would like to buy" }).getByRole("button", { name: "Accept" }).click();
  await ss.getByText("Accepted. Message them to agree payment and handover.").waitFor();
  assert.equal(one("SELECT status FROM resale_listings WHERE id = ?", board).status, "matched");
  // Erin's conversation is still open on her phone: its next look (every 30 seconds while on screen) shows the item has gone.
  await es.getByText("Yes, last week").waitFor({ timeout: 40000 });
  await es.getByText("This item has gone, so this conversation has ended. You can still read it.").waitFor({ timeout: 40000 });
  assert.equal(await es.getByPlaceholder("Write a message").isVisible(), false, "no more messages about it");
  await shot(E, "17-erin-chat-item-gone");
  await E.page.keyboard.press("Escape"); await closeLayers(S);
  await call("/relay/my/resale/listings/" + board + "/withdraw", { method: "POST", token: sam.token });
  console.log("ok - app: Erin messages the seller before asking; Bea chats and asks in her own conversation; Sam sees both and matches Bea; Erin's chat says the item has gone and stays readable");
}

// Bea blocks the seller from a conversation (her own choice, not a report): it ends, and she can unblock in Profile.
{
  const jugReceipt = await paste(sam, "Kiln Road", "Stoneware Jug", 2400, "KR-388");
  const jug = (await call("/relay/my/resale/listings", { method: "POST", token: sam.token, body: { receiptId: jugReceipt, itemIndex: 0, condition: "good", askPence: 1400, agree: true, handover: "post" } })).body.id;
  assert.equal((await call("/relay/my/resale/listings/" + jug + "/ask", { method: "POST", token: bea.token, body: { kind: "buy" } })).status, 200);
  const q = (await call("/relay/my/resale/mine", { token: sam.token })).body.listings.find(l => l.id === jug).requests[0].id;
  assert.equal((await call("/relay/my/resale/requests/" + q + "/accept", { method: "POST", token: sam.token })).status, 200);
  const reportsBefore = count("SELECT COUNT(*) FROM resale_reports");
  // A phone notification's link opens Swap & resell at Yours ...
  await S.page.goto(APP + "/index.html#open=market&tab=mine");
  await mk(S).locator('.rl-mk-tabs [data-tab="mine"][aria-pressed="true"]').waitFor({ timeout: 15000 });
  await cardOf(mk(S), "Stoneware Jug").waitFor();
  // ... or straight at the conversation (a new message's link).
  await B.page.goto(APP + "/index.html#open=market&chat=" + q);
  const sheet = mk(B);
  await sheet.getByRole("heading", { name: "Stoneware Jug" }).waitFor({ timeout: 15000 });
  await sheet.getByRole("button", { name: "Block this member" }).click();
  await B.page.getByRole("alertdialog").getByRole("button", { name: "Block", exact: true }).dblclick();
  await sheet.getByText("Blocked. They can't message you or ask about your listings.").waitFor();
  await sheet.getByText("This conversation has ended.").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_member_blocks"), 1, "blocked once");
  assert.equal(count("SELECT COUNT(*) FROM resale_reports"), reportsBefore, "and nothing reported");
  assert.equal((await call("/relay/my/resale/requests/" + q + "/messages", { method: "POST", token: sam.token, body: { body: "Hello?" } })).body.error, "conversation_closed", "Sam can't message her");
  await shot(B, "13-bea-blocked-from-chat");
  await openProfile(B.page);
  await B.page.locator("#mePage .rl-arow:visible", { hasText: "Settings" }).first().click();
  await B.page.locator(".rl-arow:visible", { hasText: "Blocked members" }).first().click();
  const row = B.page.locator(".rl-arow:visible", { hasText: "The member you talked to about Stoneware Jug" });
  await row.waitFor({ timeout: 10000 });
  assert.ok(!/sam/i.test(await row.innerText()), "never who");
  await shot(B, "14-bea-profile-blocked-members");
  await row.click();
  await B.page.getByRole("alertdialog").getByRole("button", { name: "Unblock" }).click();
  await B.page.getByText("You haven't blocked anyone").waitFor();
  assert.equal(count("SELECT COUNT(*) FROM resale_member_blocks"), 0, "unblocked");
  await call("/relay/my/resale/listings/" + jug + "/withdraw", { method: "POST", token: sam.token });
  console.log("ok - app: notification links open Yours and a conversation; Bea blocks the seller from it (no report made), sees it in Profile without who, and unblocks");
}

// The keyboard's focus ring is Relay's accent blue, not lime (only the R mark keeps lime).
assert.match(await B.page.evaluate(() => { const b = document.querySelector("#foot button"); b.focus({ focusVisible: true }); return getComputedStyle(b, ":focus-visible").outlineColor + "|" + [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).filter(r => r.selectorText === ":focus-visible").map(r => r.style.outlineColor).join(","); }), /rgb\(43, 89, 195\)/);

// Nothing in the marketplace needed an outside service, and no page had a script error.
assert.deepEqual(w.outside.filter(u => /resale/.test(u)), []);
for (const [who, errs] of errorsOf) assert.deepEqual(errs, [], "no script errors for " + who);
await browser.close(); await w.close(); app.close();
console.log("PASS marketplace end to end: the real app and Relay's real server, three members and the team (" + Math.round((Date.now() - started) / 1000) + "s)");
