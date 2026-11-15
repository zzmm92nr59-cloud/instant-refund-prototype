// Probe 2 (GitHub's servers): where M&S keeps prices, John Lewis's sitemap, Nike's product sitemaps.
const UA = "RelayBot/1.0 (+https://zzmm92nr59-cloud.github.io/instant-refund-prototype/relaybot.html)";
const get = async (u, ms = 45000) => { try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/xml,*/*", "Accept-Language": "en-GB" }, redirect: "follow", signal: AbortSignal.timeout(ms) }); const t = await r.text(); return { status: r.status, url: r.url, text: t, type: r.headers.get("content-type") }; } catch (e) { return { status: 0, text: "", err: String(e.message || e) }; } };
const locs = t => [...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, "&"));
const ldProducts = t => { const out = []; for (const m of t.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { for (const j of [].concat(JSON.parse(m[1])).flatMap(x => x["@graph"] || [x])) if (/Product/.test([].concat(j["@type"]).join())) out.push(j); } catch {} } return out; };
console.log("== M&S product page: offers and price tags");
{ const p = await get("https://www.marksandspencer.com/wool-rich-roll-neck-relaxed-jumper/p/clp22568550");
  const pr = ldProducts(p.text)[0] || {};
  console.log("keys:", Object.keys(pr).join(","));
  console.log("offers:", JSON.stringify(pr.offers || null).slice(0, 600));
  console.log("image:", JSON.stringify(pr.image || null).slice(0, 300));
  console.log("meta price:", (p.text.match(/<meta[^>]+(product:price|og:price)[^>]+>/gi) || []).slice(0, 4).join(" "));
  console.log("price-ish JSON:", (p.text.match(/"(currentPrice|price|salePrice|nowPrice)"\s*:\s*"?[£0-9.]+"?/g) || []).slice(0, 8).join(" "));
  console.log("colour-ish:", (p.text.match(/"(colou?r|colourName|swatchName)"\s*:\s*"[^"]{2,40}"/gi) || []).slice(0, 10).join(" ")); }
console.log("\n== John Lewis sitemap");
for (const u of ["https://www.johnlewis.com/siteindex.xml", "https://www.johnlewis.com/sitemap.xml"]) { const x = await get(u, 60000); console.log(u, "->", x.status, x.err || "", x.type, x.text.length, "chars", locs(x.text).length, "locations", locs(x.text).slice(0, 4).join(" ")); }
{ const p = await get("https://www.johnlewis.com/john-lewis-anyday-cotton-jersey-t-shirt/p5652457", 45000); const pr = ldProducts(p.text)[0]; console.log("JL product page ->", p.status, p.err || "", p.text.length, pr ? "Product: " + pr.name + " | offers " + JSON.stringify(pr.offers || {}).slice(0, 200) : "no Product data"); }
console.log("\n== Nike sitemaps");
{ const rb = await get("https://www.nike.com/robots.txt"); const sms = rb.text.split(/\n/).filter(l => /^sitemap:/i.test(l)).map(l => l.replace(/^sitemap:\s*/i, "").trim()); console.log(sms.join("\n"));
  for (const sm of sms.filter(s => /pdp|product/i.test(s)).slice(0, 2)) { const x = await get(sm); const ls = locs(x.text); console.log(sm, "->", x.status, ls.length, ls.filter(u => /en-gb|\/gb\//.test(u)).slice(0, 3).join(" ")); }
  const p = await get("https://www.nike.com/gb/t/air-force-1-07-shoes-WrLlWX/CW2288-111"); const pr = ldProducts(p.text)[0]; console.log("Nike product page ->", p.status, p.text.length, pr ? "Product: " + pr.name + " | offers " + JSON.stringify(pr.offers || {}).slice(0, 200) + " | color " + pr.color : "no Product data"); }
console.log("\n== Gymshark products.json");
{ const x = await get("https://uk.gymshark.com/products.json?limit=3"); let n = 0; try { n = JSON.parse(x.text).products.length; } catch {} console.log("->", x.status, n, "products"); }
