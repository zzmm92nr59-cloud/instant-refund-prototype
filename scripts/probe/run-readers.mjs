// Runs Relay's own product-page reader (worker/web-shops.js) against the real shops, from GitHub's servers.
import { WEB_SHOPS, readShop } from "../../worker/web-shops.js";
for (const shop of WEB_SHOPS.filter(s => s.reader === "pages" && /nike|gymshark/.test(s.domain))) {
  const t = Date.now(); const r = await readShop((...a) => fetch(...a), shop, Date.now()).catch(e => ({ status: "error " + e.message, rows: [] }));
  console.log("\n== " + shop.label + ": " + r.status + ", " + r.rows.length + " products in " + Math.round((Date.now() - t) / 1000) + "s");
  for (const x of r.rows.slice(0, 4)) console.log("  ", x.product, "|", x.variation, "| £" + (x.priceMinor / 100).toFixed(2), "| in stock:", x.available, "|", x.imageUrl.slice(0, 90), "|", x.productUrl.slice(0, 90));
}
