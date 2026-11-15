// Probe, run on GitHub's servers (Relay's own container can't reach shops' websites): what a shop's website lets RelayBot read.
// For each shop: the robots.txt rules for any robot ("*"), the product sitemaps, and two product pages (status, schema.org
// Product data: name, price, pictures, colour). Prints a short report. Nothing is stored; no shopper is involved.
const UA = "RelayBot/1.0 (+https://zzmm92nr59-cloud.github.io/instant-refund-prototype/relaybot.html)";
const SHOPS = [
  { name: "Marks & Spencer", origin: "https://www.marksandspencer.com" },
  { name: "John Lewis", origin: "https://www.johnlewis.com" },
  { name: "Nike UK", origin: "https://www.nike.com", path: "/gb/" },
  { name: "adidas UK", origin: "https://www.adidas.co.uk" },
  { name: "PUMA UK", origin: "https://uk.puma.com" },
  { name: "JD Sports", origin: "https://www.jdsports.co.uk" },
  { name: "Gymshark", origin: "https://uk.gymshark.com" },
];
const get = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/plain,*/*", "Accept-Language": "en-GB" }, redirect: "follow", signal: AbortSignal.timeout(20000) }); const t = await r.text(); return { status: r.status, url: r.url, text: t }; } catch (e) { return { status: 0, text: "", err: String(e.message || e) }; } };
function starRules(txt) {
  const groups = []; let cur = null, lastUA = false;
  for (const raw of txt.split(/\r?\n/)) { const l = raw.replace(/#.*/, "").trim(); if (!l) continue; const [k, ...v] = l.split(":"); const key = k.trim().toLowerCase(), val = v.join(":").trim();
    if (key === "user-agent") { if (!lastUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastUA = true; }
    else { lastUA = false; if (cur && (key === "allow" || key === "disallow")) cur.rules.push([key, val]); } }
  const g = groups.find(g => g.agents.includes("relaybot")) || groups.find(g => g.agents.includes("*")); return g ? g.rules : [];
}
function allowed(rules, path) { let best = null; for (const [k, v] of rules) { if (!v) continue; const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); if (re.test(path) && (!best || v.length > best[1].length)) best = [k, v]; } return !best || best[0] === "allow"; }
const locs = t => [...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, "&"));
for (const s of SHOPS) {
  console.log("\n== " + s.name);
  const rb = await get(s.origin + "/robots.txt");
  const rules = starRules(rb.text);
  const sitemaps = rb.text.split(/\r?\n/).filter(l => /^sitemap:/i.test(l)).map(l => l.replace(/^sitemap:\s*/i, "").trim());
  console.log("robots:", rb.status, rb.err || "", "| rules for us:", rules.length, "| '/' allowed:", allowed(rules, "/"), "| sitemaps:", sitemaps.length);
  console.log("  disallows:", rules.filter(r => r[0] === "disallow").map(r => r[1]).slice(0, 25).join(" "));
  // Find product URLs through the sitemaps (an index may point to product sitemaps).
  let products = [], seen = 0;
  const queue = sitemaps.slice(0, 6);
  while (queue.length && seen < 8 && products.length < 5) {
    const sm = queue.shift(); seen++;
    const x = await get(sm); const ls = locs(x.text);
    console.log("  sitemap", sm.slice(0, 110), "->", x.status, ls.length, "locations");
    if (/<sitemapindex/i.test(x.text)) { const prod = ls.filter(u => /product|pdp|prod|item/i.test(u)); queue.unshift(...(prod.length ? prod : ls).slice(0, 3)); console.log("    index; product-ish children:", prod.length, (prod[0] || "").slice(0, 110)); }
    else products.push(...ls.filter(u => /\/p\/|\/product|\/pd\/|\/t\/|\.html$|\/[A-Z]{2}\d{3,}/.test(u)).slice(0, 5));
  }
  console.log("  product URLs found:", products.length, (products[0] || "").slice(0, 120));
  for (const u of products.slice(0, 2)) {
    const path = new URL(u).pathname, ok = allowed(rules, path);
    if (!ok) { console.log("  page", path.slice(0, 80), "-> robots say no"); continue; }
    const p = await get(u);
    const ld = [...p.text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    let prod = null; for (const t of ld) { try { for (const j of [].concat(JSON.parse(t)).flatMap(x => x["@graph"] || [x])) if (/Product/.test([].concat(j["@type"]).join())) prod = prod || j; } catch {} }
    const og = (p.text.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || [])[1];
    console.log("  page", path.slice(0, 80), "->", p.status, p.text.length + " chars", "| Product data:", prod ? "yes" : "no", "| og:image:", og ? "yes" : "no");
    if (prod) { const off = [].concat(prod.offers || [])[0] || {}; console.log("    name:", String(prod.name).slice(0, 60), "| price:", off.price || (off.lowPrice), off.priceCurrency, "| images:", [].concat(prod.image || []).length, "| colour:", prod.color || "-", "| variants:", [].concat(prod.hasVariant || []).length); }
  }
}
