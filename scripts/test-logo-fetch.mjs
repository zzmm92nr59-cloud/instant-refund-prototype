// Offline test: fetching a shop's logo (security review L4, 25 Nov 2026). /relay/my/logo/<domain> makes Relay ask that
// shop's website for its icon. It must only ever ask public web addresses over https, never follow a redirect somewhere
// else (an address on a private network, plain http, a bare number), and never download more than a logo's size.
// The websites are stand-ins; nothing leaves this machine.
import assert from "node:assert/strict";
import { logoDomain, _fetchLogo } from "../worker/gmail.js";

// 1. Which names are looked up at all.
for (const bad of ["0x7f.0.0.1", "127.0.0.1", "10.0.0.8", "printer.local", "router.lan", "nas.home.arpa", "intranet.corp", "metadata.internal", "localhost", "1.2.3.example.0"])
  assert.equal(logoDomain(bad), null, bad + " is never looked up");
assert.equal(logoDomain("shop.kestrel-outdoor.co.uk"), "kestrel-outdoor.co.uk");
assert.equal(logoDomain("www.larkspur.com"), "larkspur.com");
console.log("ok - only public shop names are looked up");

// A PNG big enough to be a logo.
const png = (size) => { const b = new Uint8Array(size); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 180, 0, 0, 0, 180]); return b; };
let asked = [];
const site = (routes) => async (url, init = {}) => {
  asked.push(String(url));
  assert.equal(init.redirect, "manual", "redirects are never followed by fetch itself");
  const r = routes[String(url)];
  if (!r) return new Response("", { status: 404 });
  return typeof r === "function" ? r() : r;
};
const moved = (to) => new Response("", { status: 302, headers: { location: to } });

// 2. Redirects: followed only to another public https address, a few times at most.
asked = [];
let got = await _fetchLogo(site({
  "https://kestrel.example/apple-touch-icon.png": moved("https://127.0.0.1/admin.png"),
  "https://www.kestrel.example/apple-touch-icon.png": moved("http://kestrel.example/icon.png"),
  "https://www.google.com/s2/favicons?domain=kestrel.example&sz=128": moved("https://router.lan/x.png"),
  "https://kestrel.example/favicon.ico": moved("https://0x7f.0.0.1/x.png"),
  "https://www.kestrel.example/favicon.ico": moved("/relative-but-fine.png"),
  "https://www.kestrel.example/relative-but-fine.png": () => new Response(png(400), { status: 200 })
}), "kestrel.example");
assert.ok(got && got.type === "image/png", "the redirect to the same site's own https address is followed");
for (const never of ["https://127.0.0.1/admin.png", "http://kestrel.example/icon.png", "https://router.lan/x.png", "https://0x7f.0.0.1/x.png"])
  assert.ok(!asked.includes(never), "never asked: " + never);
asked = [];
const loop = {}; for (let i = 0; i < 10; i++) loop["https://loop.example/r" + i] = moved("https://loop.example/r" + (i + 1));
loop["https://loop.example/apple-touch-icon.png"] = moved("https://loop.example/r0");
got = await _fetchLogo(site(loop), "loop.example");
assert.equal(got, null);
assert.ok(asked.filter(u => u.startsWith("https://loop.example/r")).length <= 3, "at most three redirects");
console.log("ok - redirects only to public https addresses, three at most");

// 3. Size: a body bigger than a logo is never downloaded whole.
let pulled = 0;
const huge = () => new Response(new ReadableStream({ pull(c) { pulled += 65536; if (pulled > 50 * 1048576) return c.close(); c.enqueue(png(65536)); } }, { highWaterMark: 0 }), { status: 200 });
got = await _fetchLogo(site({ "https://big.example/apple-touch-icon.png": huge }), "big.example");
assert.equal(got, null, "too big: no logo");
assert.ok(pulled <= 150000 + 3 * 65536, "stopped just past the logo limit, read " + pulled);
const declared = () => new Response(png(400), { status: 200, headers: { "content-length": String(40 * 1048576) } });
asked = [];
got = await _fetchLogo(site({ "https://says.example/apple-touch-icon.png": declared }), "says.example");
assert.equal(got, null, "refused on its declared size");
console.log("ok - nothing bigger than a logo is downloaded");
console.log("PASS logo fetch: public https addresses only, no redirects elsewhere, capped size");
