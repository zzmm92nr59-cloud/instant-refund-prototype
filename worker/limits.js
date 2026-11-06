// Rate limits for every public endpoint: how many requests one caller can make in a minute
// (OWASP API Security Top 10, API4:2023 "Unrestricted Resource Consumption").
//
// Each request is counted against up to three allowances:
//   - its network address (IP). Every request counts here, signed in or not, so one machine can't flood Relay;
//   - the credential it carries, when it carries one (a shopper's session, or a shop's Relay key). One person's requests are
//     counted together wherever they come from, and the many people who can share one address (a café's wifi, a mobile
//     network) don't share one allowance between them;
//   - a tighter allowance for the requests that are worth attacking or cost the most: signing in, checking codes and
//     connecting accounts (per address), and searching or reading someone's mailbox at Google or Microsoft (per credential).
// Shopify's and Square's webhooks aren't limited here: each is checked by its signature, and those senders retry in bursts.
// Nor are Gmail's and Outlook's new-mail notices (mail-push.js), checked by Google's signature and by the subscription's secret.
// Relay's existing limits stay as they are on top of these (sign-in links per email address, wrong codes, texts, test
// pushes, resale requests and the rest, kept in the database).
//
// Counting uses Cloudflare's Rate Limiting binding when wrangler.toml declares it (RL_IP, RL_SIGNIN, RL_USER, RL_MAIL). It
// counts per Cloudflare location and is approximate by design: a guard against floods and guessing, not an exact meter.
// Without the binding (the offline tests, or an account without it) a counter in this Worker's memory does the same job,
// less precisely, since each copy of the Worker counts on its own.
// If counting itself fails, the request goes ahead: a broken counter must never lock everyone out of Relay.

export const LIMITS = {
  ip: { binding: "RL_IP", limit: 1200, period: 60 },        // anything, from one network address
  signIn: { binding: "RL_SIGNIN", limit: 30, period: 60 },  // sign-in, codes and connecting an account, from one address
  user: { binding: "RL_USER", limit: 600, period: 60 },     // anything one signed-in shopper or shop does (pictures aside)
  mail: { binding: "RL_MAIL", limit: 60, period: 60 }       // searching or reading a mailbox at Google or Microsoft
};

// Signing in, checking a code, and the pages Google, Microsoft, Square and Shopify send people back to.
const SIGN_IN = new Set([
  "/relay/auth/request", "/relay/auth/verify", "/relay/auth/verify-code", "/relay/auth/google/start", "/relay/auth/microsoft/start",
  "/relay/auth/passkey/options", "/relay/auth/passkey/verify", "/relay/auth/2fa/verify", "/relay/auth/2fa/text",
  "/relay/gmail/callback", "/relay/microsoft/callback",
  "/relay/square/connect", "/relay/square/oauth/callback",
  "/relay/shopify/connect", "/relay/shopify/launch", "/relay/shopify/oauth/callback", "/relay/shopify/embedded/session"
]);
// Each of these asks Google or Microsoft for someone's email (or reads a long pasted one).
const MAIL = new Set(["/relay/my/gmail/find", "/relay/my/gmail/add", "/relay/my/gmail/connect", "/relay/my/receipts/add-pasted", "/relay/my/receipts/parse"]);
const MAIL_RE = /^\/relay\/my\/receipts\/[0-9a-f-]{36}\/original$/;
// A long receipts list asks for many pictures at once; they're light and count only towards the address's allowance.
const PICTURE_RE = /^\/relay\/my\/(logo\/[^/]{1,100}|receipts\/[0-9a-f-]{36}\/image|resale\/listings\/[0-9a-f-]{36}\/image)$/;
// Signed by Shopify or Square; checked there. Gmail's notices come signed by Google, and Outlook's carry each subscription's
// secret (mail-push.js): they come in bursts from a few of Google's and Microsoft's addresses, for every shopper at once.
const WEBHOOKS = new Set(["/relay/webhooks/shopify", "/relay/webhooks/square", "/relay/webhooks/gmail", "/relay/webhooks/outlook", "/relay/webhooks/outlook/lifecycle"]);

// The address a request came from. Cloudflare sets cf-connecting-ip on every request it passes on.
// An IPv6 home or phone usually has a whole /64 block to itself, so those addresses are counted by their first half:
// otherwise a new address from the same block would get a fresh allowance every time.
export function addressOf(request) {
  const ip = String(request.headers.get("cf-connecting-ip") || "").trim().toLowerCase();
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip); // an IPv4 address written the IPv6 way
  if (v4) return v4[1];
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

// The credential is never kept or logged: only a short one-way fingerprint of it is used as the counter's name.
async function fingerprint(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("relay-rate:" + text)));
  return Array.from(d.slice(0, 12), b => b.toString(16).padStart(2, "0")).join("");
}

// The stand-in counter: fixed one-minute windows, kept in memory, tidied as it grows.
const memory = new Map();
function countInMemory(name, key, rule, now) {
  const k = name + "|" + key;
  let e = memory.get(k);
  if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + rule.period * 1000 }; memory.set(k, e); }
  e.count++;
  if (memory.size > 20000) for (const [mk, me] of memory) if (me.resetAt <= now) memory.delete(mk);
  return e.count <= rule.limit ? null : Math.max(1000, e.resetAt - now);
}
export function resetMemoryLimits() { memory.clear(); }

// Counts one request against one allowance. Returns null to go ahead, or how long to wait (ms) when it's over.
async function count(env, name, key, now) {
  const rule = LIMITS[name], binding = env && env[rule.binding];
  if (binding && typeof binding.limit === "function") {
    try {
      const { success } = await binding.limit({ key: name + ":" + key });
      return success ? null : rule.period * 1000;
    } catch (e) {
      console.error("rate limit check failed", rule.binding, String(e && e.message || e).slice(0, 80));
      return null; // fail open
    }
  }
  return countInMemory(name, key, rule, now);
}

// Decides whether this request may go ahead. Returns null, or { scope, retryAfterMs } for a 429.
export async function checkRateLimits(request, env, url, now = Date.now()) {
  if (request.method === "OPTIONS") return null;
  const path = url.pathname;
  if (WEBHOOKS.has(path)) return null;
  const address = addressOf(request);
  let wait = await count(env, "ip", address, now);
  if (wait) return { scope: "address", retryAfterMs: wait };
  if (SIGN_IN.has(path)) {
    wait = await count(env, "signIn", address, now);
    if (wait) return { scope: "sign_in", retryAfterMs: wait };
  }
  const auth = request.headers.get("authorization");
  if (auth && !PICTURE_RE.test(path)) {
    const who = await fingerprint(auth.slice(0, 600));
    wait = await count(env, "user", who, now);
    if (wait) return { scope: "account", retryAfterMs: wait };
    if (MAIL.has(path) || MAIL_RE.test(path)) {
      wait = await count(env, "mail", who, now);
      if (wait) return { scope: "mail", retryAfterMs: wait };
    }
  }
  return null;
}

// A plain answer the app understands ("too_many_requests"), with Retry-After so any caller knows when to come back.
export function tooManyRequests(hit, cors = {}) {
  const seconds = Math.max(1, Math.ceil(hit.retryAfterMs / 1000));
  return new Response(JSON.stringify({ error: "too_many_requests", retryAfterMs: seconds * 1000 }), {
    status: 429,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(seconds) }
  });
}
