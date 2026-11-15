// Product names, shops and kinds from Relay's preview of shops' own websites, for testing how picks read names.
import { writeFile } from "node:fs/promises";
const r = await fetch("https://relay-square-api2.9pts72cy5j.workers.dev/relay/web-shops");
const b = await r.json();
const rows = (b.products || []).map(p => ({ name: p.product, shop: p.storeName, kind: p.kind || null, price: p.priceMinor }));
await writeFile("names.json", JSON.stringify(rows));
console.log("products", rows.length, "shops", new Set(rows.map(x => x.shop)).size);
