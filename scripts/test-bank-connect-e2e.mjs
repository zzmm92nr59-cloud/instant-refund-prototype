// End-to-end test: connecting a bank, through Relay's real server (scripts/local-worker.mjs: worker.js and a real SQLite
// database on this computer) and the real app in a browser. TrueLayer and the bank stand in here, with a made-up bank and
// account; nothing leaves this computer.
// Checks:
//  1. Jess, in the app: Bank and cards, Connect, the bank's page, back to Relay with a single-use code
//     (#bank=finish&bankcode=…), which the app hands in signed in as her: the bank is connected, said plainly, and listed
//     by the name Relay gives it. The code works once.
//  2. A bank sign-in Jess started, finished in someone else's app (the link was sent to Ivy): refused, nothing is attached
//     to either account, and Ivy's app says "That bank link was started on another device. Start again here."
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url);
const LIVE_API = "https://relay-square-api2.9pts72cy5j.workers.dev";
const TYPES = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const app = createServer(async (req, res) => {
  try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => app.listen(0, "127.0.0.1", r));
const APP = "http://127.0.0.1:" + app.address().port;
const w = await startLocalWorker({ appOrigin: APP });
// Banks for everyone, through TrueLayer's live addresses (answered here, below).
Object.assign(w.env, { TRUELAYER_CLIENT_ID: "local-made-up-id", TRUELAYER_CLIENT_SECRET: "local-made-up-secret", TRUELAYER_ENV: "live", BANK_FOR_EVERYONE: "on" });

// TrueLayer and a made-up bank, in front of the local worker's "nothing outside is reachable".
const tl = { tokens: 0 };
const inner = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input && input.url ? input.url : input), u = new URL(url);
  if (u.host === "auth.truelayer.com") {
    if (u.pathname === "/connect/token") { tl.tokens++; return Response.json({ access_token: "made-up-access-" + tl.tokens, refresh_token: "made-up-refresh", expires_in: 3600 }); }
    if (u.pathname === "/api/providers") return Response.json([]);
  }
  if (u.host === "api.truelayer.com") {
    if (u.pathname === "/data/v1/me") return Response.json({ results: [{ provider: { display_name: "Fernbank", provider_id: "ob-fernbank" } }] });
    if (u.pathname === "/data/v1/accounts") return Response.json({ results: [{ account_id: "acc1", display_name: "Everyday Account", account_number: { number: "12344321" } }] });
    return Response.json({ results: [] });
  }
  return inner(input, init);
};

const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(w.origin + path, { method, redirect: "manual", headers: { "content-type": "application/json", origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { j = null; }
  return { status: r.status, body: j, location: r.headers.get("location") };
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
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200, "agreed");
  return { email, name, token, id: w.sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id };
}
const jess = await signUp("jess.banker@example.com", "Jess Banker"), ivy = await signUp("ivy.other@example.com", "Ivy Other");
const links = who => w.sqlite.prepare("SELECT bank FROM bank_links WHERE shopper_id = ?").all(who.id).map(r => r.bank);

const { chromium } = require("playwright");
const browser = await chromium.launch();
async function appFor(who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await skipInterests(ctx);
  await ctx.route(/^https?:\/\//, async route => {
    const req = route.request(), url = req.url();
    if (url.startsWith(APP)) return route.continue();
    // The bank's own page: the shopper signs in there, and it sends the browser back to Relay's callback with a code.
    // (The browser test can't step through a redirect it made up itself, so Relay's real callback is asked here and the
    // browser goes where it says: back to the app.)
    if (url.startsWith("https://auth.truelayer.com/")) {
      const q = new URL(url).searchParams;
      const back = await fetch(w.origin + "/relay/bank/callback?code=made-up-bank-code&state=" + q.get("state"), { redirect: "manual" });
      return route.fulfill({ status: 302, headers: { location: back.headers.get("location") } });
    }
    if (!url.startsWith(LIVE_API)) return route.abort();
    const headers = { ...req.headers() }; delete headers.host;
    const r = await fetch(w.origin + url.slice(LIVE_API.length), { method: req.method(), headers, redirect: "manual", body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() });
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(APP + "/index.html");
  await page.evaluate(s => localStorage.setItem("relay.session.v1", JSON.stringify({ token: s.token, email: s.email, expiresAt: Date.now() + 864e5 })), who);
  return { ctx, page, errors };
}

// 1. Jess connects her bank in the app.
{
  const { ctx, page, errors } = await appFor(jess);
  await page.reload();
  await page.evaluate(() => window.go("me"));
  const me = page.locator("#mePage");
  await me.locator(".rl-arow:visible", { hasText: "Bank and cards" }).first().click();
  await me.getByRole("button", { name: /Connect a bank or card|Another bank or card/ }).first().click();
  // The bank's page, Relay's callback, then back in the app with the code, which the app hands in.
  await me.getByText("Connected. Relay is matching your payments to your receipts.").waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => location.hash), "", "the code is out of the address");
  await me.locator(".rl-arow", { hasText: "Fernbank" }).first().waitFor();
  assert.deepEqual(links(jess), ["Fernbank"], "connected to Jess's account, once");
  assert.deepEqual(links(ivy), []);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - connecting a bank in the app: the bank's page, back with a code, finished by the app signed in as her, listed");
}
// The same code can't be used again.
{
  const start = await call("/relay/my/bank/connect", { method: "POST", token: jess.token, body: {} });
  assert.equal(start.status, 200);
  const state = new URL(start.body.url).searchParams.get("state");
  const back = await call("/relay/bank/callback?code=made-up-bank-code&state=" + state);
  const code = /bankcode=([A-Za-z0-9_-]{43})/.exec(back.location || "")[1];
  // 2. The link went to Ivy (her app, her session): refused there, and nothing is attached to anyone.
  const { ctx, page, errors } = await appFor(ivy);
  await page.goto(APP + "/index.html#bank=finish&bankcode=" + code);
  await page.locator("#mePage").getByText("That bank link was started on another device. Start again here.").waitFor({ timeout: 30000 });
  assert.deepEqual(links(ivy), [], "nothing attached to Ivy");
  assert.deepEqual(links(jess), ["Fernbank"], "and nothing more to Jess");
  // Jess can't use it afterwards either: a code works once.
  assert.equal((await call("/relay/my/bank/finish", { method: "POST", token: jess.token, body: { code } })).status, 409);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - a bank link finished in someone else's app is refused, said plainly, and the code is spent");
}
await browser.close(); await w.close(); app.close();
console.log("PASS bank connect end to end (Relay's real server and app on this computer; TrueLayer and the bank stand in with made-up data)");
