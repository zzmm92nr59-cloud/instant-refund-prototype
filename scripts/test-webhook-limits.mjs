// Offline tests: Shopify's and Square's webhooks never hold a huge body in memory, and are counted per sending address.
//  * A body is turned away on its declared size before anything is read, and one that lies about its size (or declares
//    none) is dropped as soon as more than 256 KB has arrived: the rest is never read.
//  * A request with no signature is turned away without reading its body at all.
//  * The signature is still checked over the exact bytes sent: a real, signed notice goes through, and a body that isn't
//    valid text (which decoding and re-encoding would change) is checked as sent, byte for byte.
//  * Both count against their sender's address (limits.js), so a flood from one address is refused (429).
// Shopify and Square are FAKED: the signatures here are made with test secrets, the way each documents.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { receiveShopifyWebhook } from "../worker/shopify-webhooks.js";
import { receiveSquareWebhook } from "../worker/square-webhooks.js";
import { checkRateLimits, resetMemoryLimits, LIMITS } from "../worker/limits.js";

const LIMIT = 256 * 1024;
// A database that must not be touched by anything refused.
let dbCalls = 0;
const stmt = () => ({ bind: () => stmt(), async run() { dbCalls++; return {}; }, async first() { dbCalls++; return null; }, async all() { dbCalls++; return { results: [] }; } });
const db = { prepare: () => stmt(), async batch() { dbCalls++; return []; } };
const SHOP = "relay-demo.myshopify.com";
const shopifyEnv = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", SHOPIFY_SHOP_DOMAIN: SHOP, SHOPIFY_WEBHOOK_SECRET: "wh-secret" };
const squareEnv = { RELAY_DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: "sq-secret", SQUARE_ACCESS_TOKEN: "not-a-real-token" };
const SQUARE_URL = "https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/square";
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

// A body that arrives in 64 KB pieces and counts how many were actually taken.
function stream(totalBytes) {
  const state = { pulled: 0, cancelled: false };
  const piece = new Uint8Array(64 * 1024).fill(97);
  let left = totalBytes;
  const body = new ReadableStream({
    pull(c) { if (left <= 0) return c.close(); const n = Math.min(left, piece.length); left -= n; state.pulled += n; c.enqueue(piece.subarray(0, n)); },
    cancel() { state.cancelled = true; }
  }, { highWaterMark: 0 });
  return { body, state };
}
const shopifyHeaders = (extra = {}) => ({ "x-shopify-shop-domain": SHOP, "x-shopify-topic": "orders/paid", "x-shopify-webhook-id": "wh-1", "x-shopify-hmac-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", ...extra });
const squareHeaders = (extra = {}) => ({ "x-square-hmacsha256-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", ...extra });
const hooks = [
  { name: "Shopify", send: (init) => receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST", duplex: "half", ...init, headers: shopifyHeaders(init.headers) }), shopifyEnv), sigHeader: "x-shopify-hmac-sha256", refused: 401 },
  { name: "Square", send: (init) => receiveSquareWebhook(new Request(SQUARE_URL, { method: "POST", duplex: "half", ...init, headers: squareHeaders(init.headers) }), squareEnv, ctx), sigHeader: "x-square-hmacsha256-signature", refused: 403 }
];

for (const H of hooks) {
  // 1. Declared too big: refused before a byte is read.
  { const s = stream(50 * 1024 * 1024);
    const r = await H.send({ body: s.body, headers: { "content-length": String(50 * 1024 * 1024) } });
    assert.equal(r.status, 413, H.name + ": too big by its own account");
    assert.equal(s.state.pulled, 0, "nothing was read"); }
  // 2. No declared size (or a false one): reading stops just past the limit; the other 50 MB is never taken.
  { const s = stream(50 * 1024 * 1024);
    const r = await H.send({ body: s.body });
    assert.equal(r.status, 413, H.name + ": too big as it arrives");
    assert.ok(s.state.pulled <= LIMIT + 2 * 64 * 1024, "stopped just past 256 KB, read " + s.state.pulled);
    assert.equal(s.state.cancelled, true, "and the rest was dropped"); }
  { const s = stream(10 * 1024 * 1024);
    const r = await H.send({ body: s.body, headers: { "content-length": "100" } });
    assert.equal(r.status, 413, H.name + ": a declared size that isn't true doesn't get round it");
    assert.ok(s.state.pulled <= LIMIT + 2 * 64 * 1024); }
  // 3. No signature: refused without reading the body.
  { const s = stream(100 * 1024);
    const r = await H.send({ body: s.body, headers: { [H.sigHeader]: "" } });
    assert.equal(r.status, H.refused, H.name + ": unsigned");
    assert.equal(s.state.pulled, 0, "an unsigned body isn't read at all"); }
  // 4. Exactly at the limit is still read and checked (and refused here: it isn't signed properly).
  { const s = stream(LIMIT);
    const r = await H.send({ body: s.body });
    assert.equal(r.status, H.refused, H.name + ": 256 KB exactly is read, then fails its signature");
    assert.equal(s.state.pulled, LIMIT); }
  assert.equal(dbCalls, 0, H.name + ": nothing refused touched the database");
  console.log("ok - " + H.name + " webhook: oversized bodies are refused unread or cut off at 256 KB; unsigned ones aren't read");
}

// 5. The signature is over the exact bytes sent.
{
  // Shopify: a properly signed notice is accepted (an unknown topic: acknowledged, nothing done)…
  const good = Buffer.from(JSON.stringify({ id: 1, note: "café £5 ✓" }), "utf8");
  const sig = b => createHmac("sha256", "wh-secret").update(b).digest("base64");
  const send = (bytes, signature, topic = "made/up") => receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST",
    headers: shopifyHeaders({ "x-shopify-hmac-sha256": signature, "x-shopify-topic": topic }), body: bytes }), shopifyEnv);
  assert.equal((await send(good, sig(good))).status, 200, "Shopify: signed over its exact bytes, accepted");
  const changed = Buffer.from(good); changed[5] ^= 1;
  assert.equal((await send(changed, sig(good))).status, 401, "one byte different: refused");
  // …and bytes that aren't valid text are checked as sent, not as a decoded-and-re-encoded copy (which would differ).
  const odd = Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from('"}')]);
  assert.notDeepEqual(Buffer.from(new TextDecoder().decode(odd), "utf8"), odd, "decoding would change these bytes");
  assert.equal((await send(odd, sig(odd))).status, 200, "Shopify: the signature covers the raw bytes");
  assert.equal((await send(odd, sig(Buffer.from(new TextDecoder().decode(odd), "utf8")))).status, 401, "a signature over a re-encoded copy isn't accepted");

  // Square signs its address followed by the body.
  const sq = b => createHmac("sha256", "sq-secret").update(Buffer.concat([Buffer.from(SQUARE_URL), b])).digest("base64");
  const sendSq = (bytes, signature) => receiveSquareWebhook(new Request(SQUARE_URL, { method: "POST", headers: { "x-square-hmacsha256-signature": signature }, body: bytes }), squareEnv, ctx);
  const event = Buffer.from(JSON.stringify({ event_id: "e1", type: "something.else", note: "café £5 ✓" }), "utf8");
  const ok = await sendSq(event, sq(event));
  assert.equal(ok.status, 200, "Square: signed over its address and exact bytes, accepted");
  assert.deepEqual(await ok.json(), { received: true, ignored: true });
  const changedSq = Buffer.from(event); changedSq[5] ^= 1;
  assert.equal((await sendSq(changedSq, sq(event))).status, 403, "one byte different: refused");
  assert.equal((await sendSq(event, createHmac("sha256", "sq-secret").update(event).digest("base64"))).status, 403, "signed without the address: refused");
  assert.equal((await sendSq(event, "not base64 !!")).status, 403, "a signature that isn't one: refused, not a crash");
  assert.equal((await sendSq(odd, sq(odd))).status, 400, "Square: raw bytes pass the signature; a body that isn't text is then refused as not JSON");
  console.log("ok - signatures are checked over the exact bytes sent, for Shopify and for Square");
}

// 6. Counted per sending address; nothing else.
{
  resetMemoryLimits();
  const now = 1_800_000_000_000;
  const req = (path, ip) => new Request("https://w.test" + path, { method: "POST", headers: { "cf-connecting-ip": ip } });
  for (const path of ["/relay/webhooks/shopify", "/relay/webhooks/square"]) {
    resetMemoryLimits();
    for (let i = 0; i < LIMITS.ip.limit; i++) assert.equal(await checkRateLimits(req(path, "203.0.113.50"), {}, new URL("https://w.test" + path), now), null);
    const over = await checkRateLimits(req(path, "203.0.113.50"), {}, new URL("https://w.test" + path), now);
    assert.equal(over && over.scope, "address", path + ": one address's flood is refused");
    assert.equal(await checkRateLimits(req(path, "203.0.113.51"), {}, new URL("https://w.test" + path), now), null, "another address isn't affected");
    assert.equal(await checkRateLimits(req(path, "203.0.113.50"), {}, new URL("https://w.test" + path), now + 61000), null, "and a minute later it's fine again");
  }
  console.log("ok - Shopify's and Square's webhooks are counted per sending address (" + LIMITS.ip.limit + " a minute)");
}
console.log("PASS webhooks: bodies capped at 256 KB before any signature work, exact-byte signatures, a per-address allowance");
