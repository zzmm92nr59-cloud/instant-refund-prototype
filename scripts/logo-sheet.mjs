// Contact sheets of every logo in logos/ (64px, as the app shows them, with each shop's address and size), for checking
// the inventory by eye: node scripts/logo-sheet.mjs [outdir]  → <outdir>/logos-1.png, logos-2.png, ...
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const out = process.argv[2] || "/tmp/shots";
fs.mkdirSync(out, { recursive: true });
const report = JSON.parse(fs.readFileSync("logos/_report.json", "utf8"));
// ONLY=domain,domain shows just those shops.
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const files = fs.readdirSync("logos").filter(f => !f.startsWith("_") && (!only || only.has(f.replace(/\.(png|svg|ico|jpg|webp|gif)$/, "")))).sort();
const mime = { png: "image/png", svg: "image/svg+xml", ico: "image/x-icon", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const PER = 48;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
for (let i = 0, n = 1; i < files.length; i += PER, n++) {
  const cells = files.slice(i, i + PER).map(f => {
    const d = f.replace(/\.(png|svg|ico|jpg|webp|gif)$/, ""), ext = f.split(".").pop(), h = report.hits[d] || {};
    const src = "data:" + mime[ext] + ";base64," + fs.readFileSync("logos/" + f).toString("base64");
    return `<div class="c"><div class="b"><img src="${src}"></div><div class="b dark"><img src="${src}"></div><span>${d}<br><i>${ext} ${h.px || "?"}px</i></span></div>`;
  }).join("");
  await page.setContent(`<style>body{margin:12px;font:12px system-ui;background:#f6f3ec}.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
    .c{display:flex;gap:6px;align-items:center;background:#fff;border-radius:10px;padding:6px}.b{width:64px;height:64px;display:grid;place-items:center;border-radius:12px;background:#f4f1ea;flex:none}
    .b.dark{background:#101828;width:40px;height:40px}.b img{width:48px;height:48px;object-fit:contain}.b.dark img{width:30px;height:30px}span{word-break:break-all}i{color:#667085}</style><div class="g">${cells}</div>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/logos-${n}.png`, fullPage: true });
}
await browser.close();
console.log(Math.ceil(files.length / PER) + " sheets in " + out);
