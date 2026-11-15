// Probe, run on GitHub's servers (Relay's own container can't reach shops' websites): what a shop's website lets RelayBot read.
// For each shop: robots.txt for RelayBot, its sitemaps, and one product page (status, structured product data, pictures).
// Prints a short report. Nothing is stored; nothing about any shopper is involved.
const UA = "RelayBot/1.0 (+https://zzmm92nr59-cloud.github.io/instant-refund-prototype/relaybot.html)";
const SHOPS = [
  { name: "lululemon UK", origin: "https://www.lululemon.co.uk", product: "/en-gb/p/womens-restfeel-slide/prod11021003.html" },
  { name: "lululemon (US site)", origin: "https://shop.lululemon.com", product: "/p/loungewear/W-Restfeel-Slide/_/prod11021003" },
  { name: "Sainsbury's", origin: "https://www.sainsburys.co.uk", product: null },
  { name: "Gymshark", origin: "https://uk.gymshark.com", product: null },
  { name: "Zara UK", origin: "https://www.zara.com", product: null },
  { name: "Nike UK", origin: "https://www.nike.com", product: null },
  { name: "ASOS", origin: "https://www.asos.com", product: null },
  { name: "John Lewis", origin: "https://www.johnlewis.com", product: null },
  { name: "Marks & Spencer", origin: "https://www.marksandspencer.com", product: null },
  { name: "Amazon UK", origin: "https://www.amazon.co.uk", product: null },
];
const get = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/xml,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) }); const t = await r.text(); return { status: r.status, url: r.url, text: t }; } catch (e) { return { status: 0, text: "", err: String(e.message || e) }; } };
for (const s of SHOPS) {
  console.log("\n== " + s.name);
  const rb = await get(s.origin + "/robots.txt");
  const lines = rb.text.split(/\r?\n/);
  const sitemaps = lines.filter(l => /^sitemap:/i.test(l)).map(l => l.split(/:\s*/).slice(1).join(":").trim()).slice(0, 5);
  // The "*" group's Disallow lines that touch products, and whether RelayBot is named.
  const named = lines.some(l => /user-agent:\s*relaybot/i.test(l));
  const dis = lines.filter(l => /^disallow:/i.test(l)).slice(0, 400).map(l => l.split(":").slice(1).join(":").trim());
  console.log("robots.txt:", rb.status, rb.err || "", "| sitemaps:", sitemaps.length, "| names RelayBot:", named, "| disallow '/':", dis.includes("/"), "| disallows /p/ or /product:", dis.filter(d => /^\/(p|products?|en-gb\/p)\b/.test(d)).slice(0, 5).join(" "));
  for (const sm of sitemaps.slice(0, 2)) { const x = await get(sm); console.log("  sitemap", sm, "->", x.status, x.text.length + " chars", (x.text.match(/<loc>/g) || []).length + " locations"); }
  if (s.product) {
    const p = await get(s.origin + s.product);
    const ld = [...p.text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const types = ld.map(t => { try { const j = JSON.parse(t); return [].concat(j).map(x => x["@type"]).join(","); } catch { return "unreadable"; } });
    const imgs = [...new Set((p.text.match(/https:\/\/images\.lululemon\.com\/is\/image\/lululemon\/[A-Za-z0-9_]+/g) || []))];
    const alts = [...new Set((p.text.match(/alt="[^"]{3,80}"/g) || []))].slice(0, 15);
    console.log("product page:", p.status, p.err || "", p.text.length + " chars", "| JSON-LD types:", types.join(" ; ") || "none", "| pictures:", imgs.length, imgs.slice(0, 6).join(" "));
    console.log("  alt texts:", alts.join(" | "));
    const colours = [...new Set((p.text.match(/"colou?rName"\s*:\s*"[^"]{2,60}"/g) || []))].slice(0, 15);
    console.log("  colour names in page data:", colours.join(" | ") || "none");
  }
}
