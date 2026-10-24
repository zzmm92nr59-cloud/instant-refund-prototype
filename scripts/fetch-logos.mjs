// Fetches a small logo for each UK store in scripts/uk-stores.json and saves it as logos/<domain>.png (or .ico/.jpg/.svg).
// Run by the "Fetch store logos" GitHub workflow (the build server can reach store websites). Writes logos/_report.json with every hit and miss.
import fs from "node:fs";
const stores = JSON.parse(fs.readFileSync(new URL("./uk-stores.json", import.meta.url), "utf8"));
fs.mkdirSync("logos", { recursive: true });
const UA = "Mozilla/5.0 (compatible; RelayLogoFetcher/1.0; +https://github.com/zzmm92nr59-cloud/instant-refund-prototype)";
function kind(b) {
  if (b.length < 100) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if (b.slice(0, 300).toString("utf8").includes("<svg")) return "svg";
  return null;
}
async function grab(url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,text/html;q=0.5,*/*;q=0.1" }, signal: c.signal, redirect: "follow" });
    if (!r.ok) return { err: "http " + r.status };
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 600000) return { err: "too big" };
    return { b, type: r.headers.get("content-type") || "", final: r.url };
  } catch (e) { return { err: String(e.name || e) }; } finally { clearTimeout(t); }
}
async function candidates(domain) {
  const out = [];
  for (const host of [domain, "www." + domain]) {
    const home = await grab("https://" + host + "/");
    if (home.b && /html/i.test(home.type)) {
      const html = home.b.toString("utf8", 0, 400000);
      const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(l => /rel=["']?[^"'>]*(apple-touch-icon|icon)/i.test(l));
      const scored = links.map(l => {
        const href = (/href=["']([^"']+)["']/i.exec(l) || [])[1]; if (!href) return null;
        const size = parseInt((/sizes=["'](\d+)/i.exec(l) || [])[1] || "0", 10);
        const apple = /apple-touch-icon/i.test(l);
        return { u: new URL(href, home.final).href, score: (apple ? 1000 : 0) + (size >= 120 && size <= 512 ? 200 : 0) + Math.min(size, 256) };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      for (const s of scored) out.push(s.u);
    }
    out.push("https://" + host + "/apple-touch-icon.png", "https://" + host + "/favicon.ico");
  }
  return [...new Set(out)];
}
const report = { hits: {}, misses: [] };
let next = 0;
async function worker() {
  while (next < stores.length) {
    const d = stores[next++];
    let done = false, why = [];
    for (const u of (await candidates(d)).slice(0, 8)) {
      const r = await grab(u);
      if (!r.b) { why.push(u + " " + r.err); continue; }
      const k = kind(r.b);
      if (!k) { why.push(u + " not an image"); continue; }
      fs.writeFileSync("logos/" + d + "." + k, r.b);
      report.hits[d] = { file: d + "." + k, from: u, bytes: r.b.length };
      done = true; break;
    }
    if (!done) report.misses.push({ domain: d, tried: why.slice(0, 4) });
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
report.total = stores.length; report.found = Object.keys(report.hits).length;
fs.writeFileSync("logos/_report.json", JSON.stringify(report, null, 1));
console.log("found " + report.found + " of " + report.total);
console.log("missed: " + report.misses.map(m => m.domain).join(", "));
