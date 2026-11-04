// Strict checks on everything sent to Relay's server
// (OWASP API Security Top 10 API3:2023 and API8:2023; OWASP Input Validation and Mass Assignment cheat sheets).
//
// Every request body Relay accepts, from the app, from shops' dashboards and from sign-in, is listed in ROUTES below with
// exactly the fields it takes. Before a route sees a request, its body is:
//   - read only up to that route's size limit (8 KB unless the route needs more), so a huge upload is refused unread;
//   - required to be valid UTF-8 and one JSON object (or empty);
//   - refused if any field isn't one the route takes ("reject unexpected fields", which also stops anyone setting a field
//     they shouldn't, such as someone else's id), is of the wrong type, is a string that's too long, a number outside its
//     range or not a whole number, or a list that's too long;
//   - refused if any key anywhere is __proto__, constructor or prototype (OWASP: prototype pollution);
//   - cleaned: control characters are taken out of every string (tabs and new lines stay), and from text people write for
//     other people to read (names, notes, messages) so are the invisible characters that flip which way text runs, which
//     can disguise what a message really says.
// A field may be left out, or sent as null, which means "not given". Whether a field is required, and what it means (a real
// email address, a known category, a receipt that really is this shopper's), is still checked by the route itself, which
// answers with its own specific error exactly as before: these checks sit in front of the routes' own, not instead of them.
// The route then gets a fresh copy of the request carrying the cleaned body, and reads it as it always has.
// A route that isn't listed here takes no fields at all. scripts/test-validation.mjs checks that every route is covered,
// and that every request the app made during the browser tests passes this table, so a change can't slip past by accident.

const KB = 1024;
const DEFAULT_LIMIT = 8 * KB;
const MAX_DEPTH = 6;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// C0 control characters and DEL, except tab, new line and carriage return.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Characters that change the direction text is shown in (bidirectional embeddings, overrides and isolates).
const BIDI = /[‪-‮⁦-⁩]/g;

// Field types.
const str = (max) => ({ type: "string", max });
const text = (max) => ({ type: "string", max, text: true }); // written by a person, often for someone else to read
const int = (min, max) => ({ type: "integer", min, max });
const bool = { type: "boolean" };
const one = (...values) => ({ type: "enum", values });
const obj = (fields) => ({ type: "object", fields });
const list = (max, of) => ({ type: "array", max, of });
// Order and line ids: text, or a whole number (some shops number them).
const id = (max = 200) => ({ type: "id", max });
// The app sends years as 2024 or "2024".
const year = { type: "integer", min: 1990, max: 2200, digits: true };
const NOTHING = obj({}); // the route takes no fields
const uuidish = "[0-9a-fA-F-]{36}";

// Each route: its fields, and optionally its size limit in bytes (limit) and the error to give when it's bigger (tooLarge).
const ROUTES = new Map(Object.entries({
  // Signing in (no session yet).
  "/relay/auth/request": { fields: { email: str(320) } },
  "/relay/auth/verify": { fields: { token: str(200), nonce: str(200) } },
  "/relay/auth/verify-code": { fields: { email: str(320), code: str(40) } },
  "/relay/auth/google/start": { fields: { nonce: str(200), consentVersion: str(40) } },
  "/relay/auth/microsoft/start": { fields: { nonce: str(200), consentVersion: str(40) } },
  "/relay/auth/passkey/options": NOTHING,
  "/relay/auth/passkey/verify": { limit: 30 * KB, fields: { id: str(1400), response: obj({ clientDataJSON: str(8000), authenticatorData: str(4000), signature: str(2000), userHandle: str(400) }) } },
  "/relay/auth/2fa/verify": { fields: { pendingToken: str(200), code: str(40) } },
  "/relay/auth/2fa/text": { fields: { pendingToken: str(200) } },
  "/relay/auth/logout": NOTHING,
  // The shopper's account and devices.
  "/relay/my/devices/sign-out-others": NOTHING,
  "/relay/my/delete": NOTHING,
  "/relay/my/profile": { limit: 300 * KB, tooLarge: "photo_too_big", fields: { name: text(100), photo: str(290 * KB) } },
  "/relay/my/consent": { fields: { version: str(40) } },
  "/relay/my/consent/withdraw": NOTHING,
  // Email: connecting, reading, searching and adding receipts.
  "/relay/my/gmail/connect": { fields: { provider: one("microsoft", "google"), another: bool } },
  "/relay/my/gmail/scan": { fields: { year, cursor: str(200), full: bool, small: bool } },
  "/relay/my/gmail/find": { fields: { query: str(500) } },
  "/relay/my/gmail/add": { fields: { messageId: str(600), mailbox: int(1, 5) } },
  "/relay/my/gmail/disconnect": { fields: { mailbox: int(1, 5) } },
  "/relay/my/receipts/add-pasted": { limit: 1000 * KB, fields: { email: str(250000) } },
  // The help chat: the conversation so far, as the app holds it (worker/support-chat.js checks it further).
  "/relay/my/help/chat": { limit: 64 * KB, fields: { messages: list(40, obj({ role: one("user", "assistant"), text: text(1000) })) } },
  "/relay/my/help/handoff": { limit: 64 * KB, fields: { messages: list(40, obj({ role: one("user", "assistant"), text: text(1000) })) } },
  "/relay/my/receipts/parse": { limit: 1000 * KB, fields: { email: str(250000) } },
  // Price alerts and notifications.
  "/relay/my/push/subscribe": { fields: { endpoint: str(2048), keys: obj({ p256dh: str(256), auth: str(128) }) } },
  "/relay/my/push/unsubscribe": { fields: { endpoint: str(2048) } },
  "/relay/my/push/test": NOTHING,
  "/relay/my/alerts/watch": { fields: { sku: str(200), on: bool, product: text(300), variant: text(300), store: text(200), priceMinor: int(0, 100000000) } },
  "/relay/my/alerts/store": { limit: 200 * KB, fields: { store: text(200), on: bool,
    items: list(250, obj({ sku: str(200), product: text(300), variant: text(300), priceMinor: int(0, 100000000) })) } },
  "/relay/my/alerts/mode": { fields: { mode: one("watchlist", "all") } },
  "/relay/my/alerts/check": NOTHING,
  // Resale between members.
  "/relay/my/resale/listings": { limit: 16 * KB, fields: { receiptId: str(64), itemIndex: int(0, 999), condition: str(40), size: text(60), askPence: int(0, 10000000),
    swapOk: bool, note: text(600), handover: str(20), area: text(20), agree: bool } },
  // Swaps, returns and payments.
  "/relay/my/exchange": { fields: { orderId: id(), lineId: id(), variantKey: str(300), agreedDiffMinor: int(-100000000, 100000000) } },
  "/relay/my/return": { fields: { orderId: id(), lineId: id(), reason: str(60) } },
  "/relay/my/card/setup": NOTHING,
  "/relay/my/card/confirm": { fields: { setupIntentId: str(200) } },
  "/relay/my/card/remove": NOTHING,
  // In-shop purchases (Square) and the testing tools' test shop.
  "/relay/my/instore/claim": { fields: { locationId: str(100), receiptNumber: str(40), amountMinor: int(0, 100000000), date: str(20), last4: str(8) } },
  "/relay/my/testing/square-tap": { fields: { variationId: str(100) } },
  "/relay/my/testing/square-order": { fields: { variationId: str(100) } },
  "/relay/my/testing/square-refund": { fields: { orderId: id(), lineId: id() } },
  // Passkeys, two-step sign-in and phone numbers.
  "/relay/my/passkeys/options": NOTHING,
  "/relay/my/passkeys/register": { limit: 30 * KB, fields: { id: str(1400), name: text(100), response: obj({ clientDataJSON: str(8000), attestationObject: str(16000) }) } },
  "/relay/my/passkeys/remove": { fields: { id: str(1400) } },
  "/relay/my/2fa/setup": NOTHING,
  "/relay/my/2fa/enable": { fields: { code: str(40) } },
  "/relay/my/2fa/disable": { fields: { code: str(40) } },
  "/relay/my/2fa/text": { fields: { on: bool, code: str(40) } },
  "/relay/my/2fa/text/send": NOTHING,
  "/relay/my/phone/start": { fields: { phone: str(40) } },
  "/relay/my/phone/confirm": { fields: { code: str(40) } },
  "/relay/my/phone/remove": NOTHING,
  // Relay admins: the sign-in for app reviewers (review-account.js).
  "/relay/my/admin/review-account": { fields: { on: bool } },
  // Shops (a shop's Relay key).
  "/relay/retailer/offers": { fields: { sku: str(200), offerMinor: int(0, 100000000), hours: int(0, 24 * 60), note: text(300) } },
  "/relay/retailer/payments": { fields: { method: str(40) } },
  "/relay/retailer/payments/stripe": NOTHING,
  "/relay/retailer/payments/stripe/remove": NOTHING,
  "/relay/retailer/royal-mail": { fields: { serviceCode: str(40), apiKey: str(400),
    address: obj({ name: text(150), company: text(250), line1: text(250), line2: text(250), city: text(100), postcode: str(16) }) } },
  "/relay/retailer/royal-mail/remove": NOTHING,
  // Relay inside Shopify admin: signs in with Shopify's token in the Authorization header, nothing in the body.
  "/relay/shopify/embedded/session": NOTHING,
  // The bank-link demo in the testing tools (Plaid's sandbox).
  "/plaid/exchange": { fields: { public_token: str(300) } }
}));
// Routes with an id in the path.
const PATTERNS = [
  [new RegExp("^/relay/my/receipts/" + uuidish + "/confirm$"), NOTHING],
  [new RegExp("^/relay/my/receipts/" + uuidish + "/dismiss$"), { fields: { reason: one("promo") } }],
  [new RegExp("^/relay/my/receipts/" + uuidish + "/category$"), { fields: { category: str(40) } }],
  [new RegExp("^/relay/my/receipts/" + uuidish + "/items$"), { fields: { items: list(50, obj({ index: int(0, 999), status: one("returning") })) } }],
  [new RegExp("^/relay/my/receipts/" + uuidish + "/remind$"), { fields: { on: bool } }],
  // Who a gift was for is a name the shopper types, so it's cleaned like other text people write.
  [new RegExp("^/relay/my/receipts/" + uuidish + "/gift$"), { fields: { gift: bool, for: text(40) } }],
  // "Fix this receipt": what the shopper typed in place of what Relay read (worker/gmail.js cleanFix checks it further).
  [new RegExp("^/relay/my/receipts/" + uuidish + "/fix$"), { limit: 16 * KB, fields: { shop: text(80), totalPence: int(0, 100000000), orderDate: str(10),
    items: list(50, obj({ name: text(120), qty: int(1, 999), pricePence: int(0, 100000000) })), undo: bool } }],
  [new RegExp("^/relay/my/resale/listings/" + uuidish + "/ask$"), { fields: { kind: one("swap", "buy"), message: text(600), offeredListingId: str(64) } }],
  [new RegExp("^/relay/my/resale/listings/" + uuidish + "/withdraw$"), NOTHING],
  [new RegExp("^/relay/my/resale/requests/" + uuidish + "/(accept|decline|end)$"), NOTHING],
  [new RegExp("^/relay/my/resale/requests/" + uuidish + "/messages$"), { fields: { body: text(600) } }],
  [new RegExp("^/relay/my/resale/requests/" + uuidish + "/report$"), { fields: { reason: text(300) } }],
  [new RegExp("^/relay/my/admin/reports/" + uuidish + "/review$"), { fields: { outcome: one("dismiss", "remove_listing", "block") } }],
  [/^\/relay\/my\/instore\/suggestions\/[A-Za-z0-9-]{8,64}$/, { fields: { answer: one("mine", "not_mine") } }]
];

export function schemaFor(path) {
  const exact = ROUTES.get(path);
  if (exact) return exact;
  for (const [re, s] of PATTERNS) if (re.test(path)) return s;
  return null;
}
// For the tests: every route listed here.
export const listedRoutes = () => [...ROUTES.keys()];

class Invalid extends Error { constructor(field) { super("invalid"); this.field = field; } }

function cleanString(v, isText) {
  let s = v.replace(CONTROL, "");
  if (isText) s = s.replace(BIDI, "");
  return s;
}

// Checks one value against its type and returns the cleaned value (or throws Invalid naming the field).
function check(v, s, at, depth) {
  if (v === null || v === undefined) return null; // "not given"
  if (depth > MAX_DEPTH) throw new Invalid(at);
  switch (s.type) {
    case "string": {
      if (typeof v !== "string") throw new Invalid(at);
      const c = cleanString(v, s.text);
      if (c.length > s.max) throw new Invalid(at);
      return c;
    }
    case "id": {
      if (typeof v === "number") { if (!Number.isSafeInteger(v) || v < 0) throw new Invalid(at); return v; }
      if (typeof v !== "string") throw new Invalid(at);
      const c = cleanString(v, false);
      if (c.length > s.max) throw new Invalid(at);
      return c;
    }
    case "integer": {
      let n = v;
      if (s.digits && typeof v === "string" && /^\d{1,9}$/.test(v)) n = Number(v);
      if (typeof n !== "number" || !Number.isInteger(n) || n < s.min || n > s.max) throw new Invalid(at);
      return v; // kept as sent: the route reads it as it always has
    }
    case "boolean":
      if (typeof v !== "boolean") throw new Invalid(at);
      return v;
    case "enum":
      if (!s.values.includes(v)) throw new Invalid(at);
      return v;
    case "array": {
      if (!Array.isArray(v) || v.length > s.max) throw new Invalid(at);
      return v.map((x, i) => check(x, s.of, at + "[" + i + "]", depth + 1));
    }
    case "object": {
      if (typeof v !== "object" || Array.isArray(v)) throw new Invalid(at);
      const out = {};
      for (const k of Object.keys(v)) {
        const where = at ? at + "." + k : k;
        if (BAD_KEYS.has(k) || !Object.prototype.hasOwnProperty.call(s.fields, k)) throw new Invalid(where);
        const c = check(v[k], s.fields[k], where, depth + 1);
        if (c !== null) out[k] = c;
        else if (v[k] === null) out[k] = null;
      }
      return out;
    }
    default:
      throw new Invalid(at);
  }
}

// Validates a parsed body against a route's schema. Returns { ok: true, value } or { ok: false, field }.
export function validateBody(schema, body) {
  try {
    return { ok: true, value: check(body, { type: "object", fields: schema.fields || {} }, "", 0) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, field: e.field || "body" };
    throw e;
  }
}

// Reads at most `limit` bytes of the body. Returns the text, or null when it's bigger than that.
async function readCapped(request, limit) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { try { await reader.cancel(); } catch { /* already closed */ } return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

function refuse(status, body, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Checks a request's body for its route. Returns { request } (a copy carrying the cleaned body) to carry on, or { response }
// to send back. Requests that carry no body by design (GET, HEAD, OPTIONS) pass straight through.
// A route that isn't listed takes no fields at all (deny by default): its body must be empty or {}. So a route added later
// without rules can't be sent anything until it's listed, and a module that reads the body before working out which of its
// routes was asked for never reads more than 8 KB.
export async function checkBody(request, path, cors = {}) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return { request };
  const schema = schemaFor(path) || NOTHING;
  const limit = schema.limit || DEFAULT_LIMIT;
  let raw;
  try { raw = await readCapped(request, limit); }
  catch { return { response: refuse(400, { error: "invalid_request", field: "body" }, cors) }; } // not UTF-8, or the upload broke off
  if (raw === null) return { response: refuse(413, { error: schema.tooLarge || "too_large" }, cors) };
  let value = {};
  if (raw.trim() !== "") {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { response: refuse(400, { error: "invalid_request", field: "body" }, cors) }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { response: refuse(400, { error: "invalid_request", field: "body" }, cors) };
    const v = validateBody(schema, parsed);
    if (!v.ok) return { response: refuse(400, { error: "invalid_request", field: String(v.field).slice(0, 80) }, cors) };
    value = v.value;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  // An empty body stays empty, so a route that reads "no body" today still does.
  const body = raw.trim() === "" ? "" : JSON.stringify(value);
  return { request: new Request(request, { method: request.method, headers, body }) };
}

// Sanity limits on the address itself, for every request: a very long path or query string, too many query parameters, or
// control characters in them are refused before any route runs. (Each route still checks the parameters it reads.)
export function checkUrl(url) {
  if (url.pathname.length > 1024 || url.search.length > 6144) return false;
  let n = 0;
  for (const [k, v] of url.searchParams) {
    if (++n > 60 || /[\u0000-\u001F\u007F]/.test(k) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) return false;
  }
  return !/[\u0000-\u001F\u007F]/.test(decodeURIComponentSafe(url.pathname));
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
