// Offline test for delivery details and starting a checkout at a shop's own website with them filled in (worker/delivery.js).
// The shop is a stand-in: nothing leaves this machine. Made-up people, addresses and products.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { cleanDelivery, cleanPostcode, cleanUkPhone, ucpProfile, handleUcpProfileRoute, parseWebSku, checkoutUrlOk, checkoutRequest, checkoutFrom,
  handleDeliveryRoute, startWebCheckout, deliveryDeleteStatements, deliveryForExport, ensureDeliveryTables, CHECKOUTS_PER_DAY } from "../worker/delivery.js";
import { ensureWebShopTables, WEB_SHOPS } from "../worker/web-shops.js";
import { REVIEW_BLOCKED } from "../worker/review-account.js";
import { checkBody } from "../worker/validate.js";

// 1. The details: checked and tidied, or which field to fix.
const good = { firstName: "Siân", lastName: "O'Neill-Smith", line1: "12 High Street", line2: "Flat 3/B", town: "London", county: "", postcode: "sw111aa", phone: "07700 900 456" };
const c = cleanDelivery(good);
assert.deepEqual(c.value, { firstName: "Siân", lastName: "O'Neill-Smith", line1: "12 High Street", line2: "Flat 3/B", town: "London", county: null, postcode: "SW11 1AA", phone: "+447700900456" });
for (const [field, value] of [["firstName", ""], ["lastName", "J0hn$"], ["line1", ""], ["line1", "12 High St 🏠"], ["line2", "x".repeat(101)], ["town", " "], ["postcode", "SW11"], ["postcode", "12345"], ["phone", "12345"], ["phone", "+33 6 12 34 56 78"]])
  assert.equal(cleanDelivery({ ...good, [field]: value }).error, field, field + " = " + JSON.stringify(value) + " is refused, and says which field");
assert.equal(cleanDelivery({ ...good, phone: "" }).value.phone, null, "the phone number is optional");
assert.equal(cleanDelivery({ ...good, line2: null }).value.line2, null, "so is the second line");
assert.equal(cleanPostcode("ec1a1bb"), "EC1A 1BB"); assert.equal(cleanPostcode("M1 1AE"), "M1 1AE"); assert.equal(cleanPostcode("B33 8TH"), "B33 8TH"); assert.equal(cleanPostcode("CR2 6XH"), "CR2 6XH");
assert.equal(cleanPostcode("DN55 1PT"), "DN55 1PT"); assert.equal(cleanPostcode("not one"), null);
assert.equal(cleanUkPhone("+44 (0)20 7946 0018"), "+442079460018", "a landline"); assert.equal(cleanUkPhone("0044 7700 900123"), "+447700900123");
assert.equal(cleanUkPhone("447700900123"), "+447700900123"); assert.equal(cleanUkPhone("0800 123 4567"), "+448001234567"); assert.equal(cleanUkPhone("999"), null);
console.log("ok - delivery details: names in any language, address lines, UK postcodes and phone numbers tidied; each wrong field named");

// 2. Relay's agent profile: checkout and delivery details (which extends checkout); no keys, since requests aren't signed yet.
const p = ucpProfile();
assert.equal(p.ucp.version, "2026-08-25");
assert.deepEqual(Object.keys(p.ucp.capabilities), ["dev.ucp.shopping.checkout", "dev.ucp.shopping.fulfillment"]);
assert.equal(p.ucp.capabilities["dev.ucp.shopping.fulfillment"][0].extends, "dev.ucp.shopping.checkout");
assert.equal(p.ucp.services["dev.ucp.shopping"][0].transport, "mcp");
assert.ok(!("keys" in p) && !("signing_keys" in p.ucp), "nothing to sign with yet");
const pr = handleUcpProfileRoute(new Request("https://api.relay.test/.well-known/ucp"), new URL("https://api.relay.test/.well-known/ucp"), {});
assert.equal(pr.status, 200); assert.deepEqual(await pr.json(), p);
assert.match(pr.headers.get("Cache-Control"), /public, max-age=\d+/); assert.equal(pr.headers.get("Access-Control-Allow-Origin"), "*");
assert.equal(handleUcpProfileRoute(new Request("https://api.relay.test/x"), new URL("https://api.relay.test/x"), {}), null);
console.log("ok - Relay's agent profile says it takes part in checkout with delivery details, and anyone can read it");

// 3. What a shop is sent, and what's taken from its answer.
assert.deepEqual(parseWebSku("web:finisterre.com:58572635603328"), { domain: "finisterre.com", variant: "58572635603328" });
assert.equal(parseWebSku("web:finisterre.com:12x"), null); assert.equal(parseWebSku("shopify:a.myshopify.com:variant:1"), null); assert.equal(parseWebSku(null), null);
assert.equal(checkoutUrlOk("https://finisterre.myshopify.com/cart/c/abc?key=1", "finisterre.com"), true);
assert.equal(checkoutUrlOk("https://finisterre.com/checkouts/cn/abc", "finisterre.com"), true);
assert.equal(checkoutUrlOk("https://www.rixo.co.uk/checkouts/cn/abc", "www.rixo.co.uk"), true);
assert.equal(checkoutUrlOk("http://finisterre.com/checkouts/cn/abc", "finisterre.com"), false, "https only");
assert.equal(checkoutUrlOk("https://evil.test/finisterre.com", "finisterre.com"), false, "never another website");
assert.equal(checkoutUrlOk("https://user:pw@finisterre.com/x", "finisterre.com"), false);
const req = checkoutRequest({ variant: "77", email: "sian@example.com", delivery: c.value, profile: "https://api.relay.test/.well-known/ucp", key: "k1" });
assert.equal(req.method, "tools/call"); assert.equal(req.params.name, "create_checkout");
assert.deepEqual(req.params.arguments.meta, { "ucp-agent": { profile: "https://api.relay.test/.well-known/ucp" }, "idempotency-key": "k1" });
const ck = req.params.arguments.checkout;
assert.deepEqual(ck.line_items, [{ quantity: 1, item: { id: "gid://shopify/ProductVariant/77" } }]);
assert.deepEqual(ck.buyer, { email: "sian@example.com", phone_number: "+447700900456" });
assert.deepEqual(ck.context, { address_country: "GB", currency: "GBP", postal_code: "SW11 1AA" });
assert.deepEqual(ck.fulfillment, { methods: [{ type: "shipping", selected_destination_id: "home", destinations: [{ id: "home", first_name: "Siân", last_name: "O'Neill-Smith",
  phone_number: "+447700900456", street_address: "12 High Street", extended_address: "Flat 3/B", address_locality: "London", postal_code: "SW11 1AA", address_country: "GB" }] }] });
assert.deepEqual(ck.attribution, { utm_source: "relay", utm_medium: "app" });
const noPhone = checkoutRequest({ variant: "77", email: "sian@example.com", delivery: c.value, profile: "x", key: "k2", withPhone: false }).params.arguments.checkout;
assert.ok(!("phone_number" in noPhone.buyer) && !("phone_number" in noPhone.fulfillment.methods[0].destinations[0]), "without the phone number when the shop refused it");
const bare = checkoutRequest({ variant: "77", email: "sian@example.com", delivery: null, profile: "x", key: "k3" }).params.arguments.checkout;
assert.ok(!("fulfillment" in bare) && !("postal_code" in bare.context), "no address saved: just the item and the email");
assert.equal(checkoutFrom({ result: { content: [{ type: "text", text: JSON.stringify({ continue_url: "https://a.test/x" }) }] } }).checkout.continue_url, "https://a.test/x", "from the text when there's no structured part");
assert.equal(checkoutFrom({ error: { code: -32602 } }), null);
console.log("ok - a shop is sent the item, the email, and the name, address and phone; its checkout page must be on its own website or Shopify");

// 4. Starting a checkout, against a stand-in shop.
const sqlite = new DatabaseSync(":memory:");
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const x = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(x.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
let queue = Promise.resolve();
const db = { prepare: sql => stmt(sql), batch: (list) => (queue = queue.then(async () => { sqlite.exec("BEGIN"); try { for (const s of list) await s.run(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } })) };
const env = { RELAY_DB: db };
await ensureWebShopTables(db); await ensureDeliveryTables(db);
const NOW = 1_800_000_000_000, SKU = "web:finisterre.com:58572635603328";
assert.ok(WEB_SHOPS.some(s => s.domain === "finisterre.com"));
sqlite.prepare("INSERT INTO web_shops (domain, label, origin, status, products, items, checked_at, next_at) VALUES ('finisterre.com', 'Finisterre', 'https://finisterre.com', 'ok', 1, 2, ?, ?)").run(NOW, NOW + 864e5);
sqlite.prepare("INSERT INTO web_shop_items (id, domain, product_key, position, product, variation, price_minor, available, image_url, product_url, kind, checked_at) VALUES (?, 'finisterre.com', 'p1', 0, 'Fisherman Beanie', 'Otter Brown', 3500, 1, 'https://cdn.shopify.com/a.jpg', 'https://finisterre.com/products/beanie', null, ?)").run(SKU, NOW);
sqlite.prepare("INSERT INTO web_shop_items (id, domain, product_key, position, product, variation, price_minor, available, image_url, product_url, kind, checked_at) VALUES ('web:finisterre.com:99', 'finisterre.com', 'p2', 1, 'Rain Shell', 'Navy', 14500, 0, 'https://cdn.shopify.com/b.jpg', 'https://finisterre.com/products/shell', null, ?)").run(NOW);
const shopper = { id: "s-1", email: "sian@example.com" };
let asked = [], answer = null;
const shopSays = (o) => ({ result: { structuredContent: { ucp: { version: "2026-08-25", status: o.error ? "error" : "success" }, id: "gid://shopify/Checkout/abc?key=1", status: "requires_escalation",
  messages: o.messages || [], continue_url: o.url === undefined ? "https://finisterre.myshopify.com/cart/c/abc?key=xyz" : o.url, totals: [{ type: "total", amount: 3500 }] }, isError: Boolean(o.error) } });
const fetchImpl = async (url, init) => {
  asked.push({ url: String(url), init, body: JSON.parse(init.body) });
  const a = typeof answer === "function" ? answer(asked.length) : answer;
  if (a === "down") throw new TypeError("fetch failed");
  if (a && a.status) return new Response("busy", { status: a.status });
  return Response.json(a);
};
const call = async (path, method = "POST", body) => {
  const r = await handleDeliveryRoute(new Request("https://api.relay.test" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), env, new URL("https://api.relay.test" + path), {}, shopper, { now: NOW, fetchImpl });
  return { status: r.status, body: await r.json() };
};
// No address saved yet: the item and the email only.
assert.deepEqual((await call("/relay/my/delivery", "GET")).body, { delivery: null });
answer = shopSays({ messages: [{ code: "delivery_address_required", severity: "recoverable" }] });
let r = await call("/relay/my/web-checkout", "POST", { sku: SKU });
assert.equal(r.status, 200);
assert.deepEqual(r.body, { url: "https://finisterre.myshopify.com/cart/c/abc?key=xyz", shop: "Finisterre", emailFilled: true, addressFilled: false });
assert.equal(asked[0].url, "https://finisterre.com/api/ucp/mcp", "the shop's own checkout server, from Relay's list");
assert.equal(asked[0].init.method, "POST"); assert.equal(asked[0].init.redirect, "manual");
assert.match(asked[0].init.headers["User-Agent"], /^RelayBot\//);
assert.equal(asked[0].body.params.arguments.meta["ucp-agent"].profile, "https://api.relay.test/.well-known/ucp", "Relay's own profile, from its own address");
assert.match(asked[0].body.params.arguments.meta["idempotency-key"], /^[0-9a-f-]{36}$/);
assert.ok(!("fulfillment" in asked[0].body.params.arguments.checkout));
// Saving an address: checked, tidied and kept with the account.
r = await call("/relay/my/delivery", "POST", { ...good, postcode: "nope" });
assert.deepEqual([r.status, r.body], [400, { error: "bad_field", field: "postcode" }]);
r = await call("/relay/my/delivery", "POST", good);
assert.equal(r.status, 200); assert.equal(r.body.delivery.postcode, "SW11 1AA");
assert.equal((await call("/relay/my/delivery", "GET")).body.delivery.line1, "12 High Street");
// With the address: the shop takes it.
asked = []; answer = shopSays({ messages: [{ code: "extension_interaction_required", severity: "requires_buyer_input" }] });
r = await call("/relay/my/web-checkout", "POST", { sku: SKU });
assert.deepEqual(r.body, { url: "https://finisterre.myshopify.com/cart/c/abc?key=xyz", shop: "Finisterre", emailFilled: true, addressFilled: true });
assert.equal(asked[0].body.params.arguments.checkout.fulfillment.methods[0].destinations[0].postal_code, "SW11 1AA");
// The shop refuses the phone number: once more without it.
asked = []; answer = (n) => n === 1 ? shopSays({ error: true, url: "https://finisterre.myshopify.com/", messages: [{ code: "buyer_identity_phone_is_invalid", severity: "unrecoverable" }] }) : shopSays({});
r = await call("/relay/my/web-checkout", "POST", { sku: SKU });
assert.equal(r.status, 200); assert.equal(r.body.addressFilled, true);
assert.equal(asked.length, 2); assert.equal(asked[0].body.params.arguments.checkout.buyer.phone_number, "+447700900456");
assert.ok(!("phone_number" in asked[1].body.params.arguments.checkout.buyer), "asked again without the phone number");
assert.notEqual(asked[0].body.params.arguments.meta["idempotency-key"], asked[1].body.params.arguments.meta["idempotency-key"]);
// Anything else wrong: no checkout, and the app opens the shop's basket instead.
for (const [a, status, error] of [[shopSays({ error: true, messages: [{ code: "out_of_stock" }] }), 502, "shop_checkout_failed"], [shopSays({ url: "https://evil.test/checkout" }), 502, "shop_checkout_failed"],
  [shopSays({ url: null }), 502, "shop_checkout_failed"], [{ status: 429 }, 503, "shop_busy"], [{ status: 500 }, 502, "shop_checkout_failed"], ["down", 502, "shop_checkout_failed"], [{ jsonrpc: "2.0", error: { code: -32602 } }, 502, "shop_checkout_failed"]]) {
  answer = a; r = await call("/relay/my/web-checkout", "POST", { sku: SKU });
  assert.deepEqual([r.status, r.body], [status, { error }], JSON.stringify(a).slice(0, 80));
}
// Only shops in Relay's own list, only products Relay has seen, and not what's sold out.
asked = []; answer = shopSays({});
assert.deepEqual((await call("/relay/my/web-checkout", "POST", { sku: "web:evil.test:1" })).body, { error: "not_a_web_shop" });
assert.deepEqual((await call("/relay/my/web-checkout", "POST", { sku: "https://evil.test" })).body, { error: "not_a_web_shop" });
assert.deepEqual((await call("/relay/my/web-checkout", "POST", { sku: "web:finisterre.com:12345" })).body, { error: "not_found" });
assert.deepEqual((await call("/relay/my/web-checkout", "POST", { sku: "web:finisterre.com:99" })).body, { error: "sold_out" });
assert.equal(asked.length, 0, "none of those asked a shop anything");
console.log("ok - a checkout at the shop: the email, then the address once saved; without the phone number if the shop refuses it; otherwise none, and nothing for other websites");

// 5. A day's limit, the record of where the address went, removing it, and deleting the account.
const n = sqlite.prepare("SELECT COUNT(*) AS n FROM web_checkouts WHERE shopper_id = 's-1'").get().n;
assert.equal(n, 3, "each checkout started is noted (the failed ones aren't)");
for (let i = n; i < CHECKOUTS_PER_DAY; i++) sqlite.prepare("INSERT INTO web_checkouts (shopper_id, domain, shop, product, at, address) VALUES ('s-1', 'finisterre.com', 'Finisterre', 'x', ?, 1)").run(NOW + 1 + i);
answer = shopSays({});
assert.deepEqual((await call("/relay/my/web-checkout", "POST", { sku: SKU })).body, { error: "too_many_checkouts" });
const ex = await deliveryForExport(env, "s-1");
assert.equal(ex.details.postcode, "SW11 1AA");
assert.deepEqual(ex.checkoutsStartedAtShops[0], { shop: "Finisterre", product: "Fisherman Beanie", at: new Date(NOW).toISOString(), addressSent: false });
assert.equal(ex.checkoutsStartedAtShops[1].addressSent, true);
assert.deepEqual((await call("/relay/my/delivery/remove", "POST")).body, { delivery: null });
assert.deepEqual((await call("/relay/my/delivery", "GET")).body, { delivery: null });
await call("/relay/my/delivery", "POST", good);
await db.batch(deliveryDeleteStatements(db, "s-1"));
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM delivery_details").get().n + sqlite.prepare("SELECT COUNT(*) AS n FROM web_checkouts").get().n, 0, "deleting the account deletes both");
assert.equal((await deliveryForExport({ RELAY_DB: { prepare: () => { throw new Error("no such table: delivery_details"); } } }, "x")).details, null, "never used: empty");
assert.ok(REVIEW_BLOCKED.has("/relay/my/delivery"), "the shared reviewer account can't keep an address");
console.log("ok - 40 checkouts a day; Download my data lists the address and each shop it went to; removing and deleting the account clear it");

// 6. The input rules: only these fields, at sensible lengths.
const v = async (path, body) => checkBody(new Request("https://api.relay.test" + path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), path);
for (const [path, body, ok] of [["/relay/my/delivery", good, true], ["/relay/my/delivery", { ...good, isAdmin: true }, false], ["/relay/my/delivery", { ...good, line1: "x".repeat(201) }, false],
  ["/relay/my/web-checkout", { sku: SKU }, true], ["/relay/my/web-checkout", { sku: SKU, url: "https://evil.test" }, false], ["/relay/my/delivery/remove", {}, true], ["/relay/my/delivery/remove", { x: 1 }, false]]) {
  const res = await v(path, body);
  assert.equal(!res || !res.response, ok, path + " " + JSON.stringify(body).slice(0, 60));
}
console.log("ok - the server takes only the delivery fields and a product, nothing else");
console.log("PASS delivery details and shops' checkouts filled in");
