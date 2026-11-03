// Builds Relay's own logo inventory: for each UK shop in scripts/uk-stores.json, the sharpest logo it can find is saved as
// logos/<domain>.<png|svg|ico|jpg|webp>, so the app shows well-known shops' logos from Relay's own site (quick, and no
// outside service learns which shops a shopper has receipts from).
// Run by the "Fetch store logos" GitHub workflow (the build server can reach shops' websites; most block other servers).
//
// Where it looks, in order: the shop's home page (its <link rel="icon"/"apple-touch-icon"> tags and the icons in its web
// app manifest), /apple-touch-icon.png and /favicon.ico, then Google's copy of the shop's icon (Google can read shops that
// block other servers). Every picture found is measured and the best kept: the largest at least 48px across (a 32px one
// only when nothing bigger exists), preferring PNG and SVG, under 150KB. A shop already in logos/ keeps its file unless a
// sharper one is found. logos/_report.json lists every shop with where its logo came from and its size, and every miss.
import fs from "node:fs";
const stores = JSON.parse(fs.readFileSync(new URL("./uk-stores.json", import.meta.url), "utf8"));
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(x => x.trim()).filter(Boolean)) : null;
// Shops checked by eye whose own icon is wrong or poor (scripts/uk-store-logo-overrides.json): "google" uses Google's copy
// even when the site's is bigger; "drop" keeps no logo for that shop.
const overrides = (() => { try { return JSON.parse(fs.readFileSync(new URL("./uk-store-logo-overrides.json", import.meta.url), "utf8")); } catch { return {}; } })();
fs.mkdirSync("logos", { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 RelayLogoFetcher/2.0";
const MAX_BYTES = 150000;

// The picture's type from its first bytes (never from what the server says).
function kind(b) {
  if (!b || b.length < 60) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.toString("latin1", 0, 3) === "GIF") return "gif";
  const head = b.toString("utf8", 0, Math.min(b.length, 600));
  if (/<svg[\s>]/i.test(head) && !/<html[\s>]/i.test(head)) return "svg";
  return null;
}
// Its size in pixels (the larger side), or null if it can't be read. An SVG draws at any size.
function px(b, k) {
  try {
    if (k === "png") return Math.max(b.readUInt32BE(16), b.readUInt32BE(20));
    if (k === "gif") return Math.max(b.readUInt16LE(6), b.readUInt16LE(8));
    if (k === "ico") { let best = 0; for (let i = 0, n = b.readUInt16LE(4); i < n && 6 + i * 16 + 16 <= b.length; i++) { const w = b[6 + i * 16] || 256; best = Math.max(best, w); } return best || null; }
    if (k === "jpg") { for (let i = 2; i + 9 < b.length;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return Math.max(b.readUInt16BE(i + 5), b.readUInt16BE(i + 7)); i += 2 + len; } return null; }
    if (k === "webp") {
      const f = b.toString("latin1", 12, 16);
      if (f === "VP8X") return Math.max(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
      if (f === "VP8L") { const v = b.readUInt32LE(21); return Math.max((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1); }
      if (f === "VP8 ") return Math.max(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    }
    if (k === "svg") return 512;
  } catch { /* unreadable */ }
  return null;
}
async function grab(url, accept = "image/*,*/*;q=0.5") {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept, "accept-language": "en-GB,en;q=0.9" }, signal: c.signal, redirect: "follow" });
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, b, type: r.headers.get("content-type") || "", final: r.url };
  } catch (e) { return { err: String(e.name || e) }; } finally { clearTimeout(t); }
}
// Every icon a home page points to, with the size it says it is.
async function fromHomePage(domain) {
  const out = [];
  for (const host of [domain, "www." + domain]) {
    const home = await grab("https://" + host + "/", "text/html,*/*;q=0.5");
    if (!home.b || home.status >= 400 || !/html/i.test(home.type)) continue;
    const html = home.b.toString("utf8", 0, 600000);
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const l = m[0];
      if (!/rel=["']?[^"'>]*(apple-touch-icon|icon)/i.test(l)) continue;
      const href = (/href=["']([^"']+)["']/i.exec(l) || [])[1]; if (!href || href.startsWith("data:")) continue;
      // An SVG icon ("sizes=any") draws sharp at any size, so it is tried among the first.
      const svg = /\.svg(\?|$)/i.test(href) || /sizes=["']?any/i.test(l);
      try { out.push({ u: new URL(href, home.final).href, says: svg ? 512 : parseInt((/sizes=["']?(\d+)/i.exec(l) || [])[1] || "0", 10), from: "page" }); } catch {}
    }
    const man = (/<link\b[^>]*rel=["']?manifest["']?[^>]*>/i.exec(html) || [])[0];
    const mhref = man && (/href=["']([^"']+)["']/i.exec(man) || [])[1];
    if (mhref) {
      try {
        const murl = new URL(mhref, home.final).href, mr = await grab(murl, "application/manifest+json,application/json,*/*;q=0.5");
        const j = mr.b && mr.status < 400 ? JSON.parse(mr.b.toString("utf8")) : null;
        for (const ic of (j && Array.isArray(j.icons) ? j.icons : [])) {
          if (!ic || typeof ic.src !== "string" || /monochrome/i.test(ic.purpose || "")) continue;
          out.push({ u: new URL(ic.src, murl).href, says: parseInt(String(ic.sizes || "0"), 10) || 0, from: "manifest" });
        }
      } catch {}
    }
    if (out.length) break;
  }
  return out;
}
const googleCopy = domain => "https://www.google.com/s2/favicons?domain=" + domain + "&sz=256";
// DuckDuckGo's copy is the shop's own favicon.ico, which often holds a 32px or 48px picture Google doesn't have. For a site
// it doesn't know it sends a stand-in picture, which is recognised and skipped.
const duckCopy = domain => "https://icons.duckduckgo.com/ip3/" + domain + ".ico";
let duckStandIn = null;
// A big shop whose website icons are too small to use (Sainsbury's, Subway...): the icon of its own app in Apple's App
// Store, which is its square logo made for small screens. "appstore:<search>|<word the app or its maker must have>".
async function appStoreIcon(spec) {
  const [term, must] = spec.split("|");
  const r = await grab("https://itunes.apple.com/search?" + new URLSearchParams({ term, country: "gb", entity: "software", limit: "15" }), "application/json");
  if (!r.b || r.status >= 400) return null;
  let j; try { j = JSON.parse(r.b.toString("utf8")); } catch { return null; }
  const want = String(must || term).toLowerCase();
  const hit = (j.results || []).find(a => [a.sellerName, a.artistName].some(x => String(x || "").toLowerCase().includes(want)))
    || (j.results || []).find(a => String(a.trackName || "").toLowerCase().includes(want));
  return hit ? hit.artworkUrl512 || hit.artworkUrl100 || null : null;
}
async function candidates(domain) {
  const how = overrides[domain];
  if (typeof how === "string" && how.startsWith("appstore:")) { const u = await appStoreIcon(how.slice(9)); return u ? [u] : []; }
  if (how === "google") return [googleCopy(domain), duckCopy(domain)];
  if (how === "duck") return [duckCopy(domain)];
  if (typeof how === "string" && how.startsWith("https://")) return [how];
  const page = await fromHomePage(domain);
  page.sort((a, b) => b.says - a.says);
  const list = [...page.slice(0, 6).map(x => x.u),
    "https://" + domain + "/apple-touch-icon.png", "https://www." + domain + "/apple-touch-icon.png",
    "https://" + domain + "/favicon.ico", "https://www." + domain + "/favicon.ico",
    googleCopy(domain), duckCopy(domain)];
  return [...new Set(list)];
}
const score = (p, k) => Math.min(p, 512) + (k === "png" || k === "svg" ? 40 : k === "ico" ? 0 : 20);
const existing = file => { for (const e of ["png", "svg", "ico", "jpg", "webp", "gif"]) if (fs.existsSync("logos/" + file + "." + e)) return e; return null; };
let report = { hits: {}, misses: [] };
try { const old = JSON.parse(fs.readFileSync("logos/_report.json", "utf8")); if (old && old.hits) report.hits = old.hits; if (old && Array.isArray(old.misses)) report.misses = old.misses; } catch {}
// Logos already saved by an earlier run are measured, so a new one only replaces them when it is sharper.
for (const d of stores) { const e = existing(d); if (e && (!report.hits[d] || !report.hits[d].px)) { const b = fs.readFileSync("logos/" + d + "." + e); report.hits[d] = { ...(report.hits[d] || {}), file: d + "." + e, px: px(b, kind(b)) || null, bytes: b.length }; } }
for (const [d, how] of Object.entries(overrides)) {
  if (how !== "drop") continue;
  const e = existing(d); if (e) fs.unlinkSync("logos/" + d + "." + e);
  delete report.hits[d];
}
const todo = stores.filter(d => (!only || only.has(d)) && overrides[d] !== "drop");
let next = 0;
async function worker() {
  while (next < todo.length) {
    const d = todo[next++];
    let best = null; const why = [];
    for (const u of await candidates(d)) {
      const r = await grab(u);
      if (!r.b || r.err) { why.push(u + " " + (r.err || "")); continue; }
      if (r.status >= 400) { why.push(u + " http " + r.status); continue; }
      const k = kind(r.b);
      if (!k) { why.push(u + " not a picture"); continue; }
      if (u.startsWith("https://icons.duckduckgo.com/") && duckStandIn && r.b.equals(duckStandIn)) { why.push(u + " stand-in"); continue; }
      if (r.b.length > MAX_BYTES) { why.push(u + " too big"); continue; }
      const p = px(r.b, k);
      if (!p || p < 32) { why.push(u + " " + (p || "?") + "px"); continue; }
      const s = score(p, k);
      if (!best || s > best.s) best = { s, b: r.b, k, p, u };
      if (p >= 180 && (k === "png" || k === "svg")) break;   // sharp enough: no need to look further
    }
    const had = existing(d), oldPx = report.hits[d] && report.hits[d].px, forced = Boolean(overrides[d]) && overrides[d] !== "drop";
    if (best && (best.p >= 48 || !had || forced) && (forced || !had || !oldPx || best.p >= oldPx)) {
      if (had && had !== best.k) fs.unlinkSync("logos/" + d + "." + had);
      fs.writeFileSync("logos/" + d + "." + best.k, best.b);
      report.hits[d] = { file: d + "." + best.k, from: best.u, px: best.p, bytes: best.b.length };
      report.misses = report.misses.filter(m => m.domain !== d);
    } else if (!had || forced) {
      // A logo checked by eye as wrong or too poor is removed when nothing better turns up.
      if (had) { fs.unlinkSync("logos/" + d + "." + had); delete report.hits[d]; }
      report.misses = report.misses.filter(m => m.domain !== d).concat({ domain: d, tried: why.slice(0, 6) });
    }
  }
}
{ const r = await grab(duckCopy("no-such-shop-" + Date.now() + ".co.uk")); duckStandIn = r.b && r.status < 400 ? r.b : null; }
await Promise.all(Array.from({ length: 8 }, worker));
// Shops no longer on the list are dropped from the report (their files stay until removed by hand).
report.total = stores.length; report.found = stores.filter(d => existing(d)).length;
report.misses = report.misses.filter(m => stores.includes(m.domain) && !existing(m.domain) && overrides[m.domain] !== "drop");
fs.writeFileSync("logos/_report.json", JSON.stringify(report, null, 1));
const small = Object.entries(report.hits).filter(([d, h]) => stores.includes(d) && h.px && h.px < 64).map(([d, h]) => d + " " + h.px + "px");
console.log("found " + report.found + " of " + report.total);
console.log("under 64px: " + small.join(", "));
console.log("missed: " + report.misses.map(m => m.domain).join(", "));
