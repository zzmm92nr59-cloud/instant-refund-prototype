// Browser test for relay-corners.js (smooth, iPhone-style corners). Made-up boxes only, no Relay server.
// Checks: a rounded card is smoothed; pills, circles, small radii, shadows and data-round="plain" are left alone; an
// even border and a thin inset ring are drawn again along the smooth edge (and the CSS one hidden); the smooth shape
// never goes outside the CSS rounded corner; things added later and things that grow are shaped; a changed border
// colour is picked up; a box rounded right round at its size is left as it is; the app still loads it.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const code = await readFile(new URL("../relay-corners.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.ok(html.includes('<script src="relay-corners.js" defer></script>'), "the app loads relay-corners.js");
assert.ok((await readFile(new URL("../sw.js", import.meta.url), "utf8")).includes('"relay-corners.js"'), "kept for offline use");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 700 } });
await page.setContent(`<style>.on{border-color:#c7f567!important}</style><body style="margin:0">
<div id="card" style="width:300px;height:120px;background:#000;border-radius:22px"></div>
<div id="plain" data-round="plain" style="width:300px;height:60px;background:#000;border-radius:22px"></div>
<div id="pill" style="width:200px;height:44px;background:#000;border-radius:999px"></div>
<div id="circle" style="width:44px;height:44px;background:#000;border-radius:50%"></div>
<div id="small" style="width:100px;height:40px;background:#000;border-radius:4px"></div>
<div id="shadow" style="width:100px;height:40px;background:#000;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.2)"></div>
<div id="bordered" style="width:200px;height:60px;border:1px solid rgb(204, 204, 204);border-radius:14px"></div>
<div id="ring" style="width:140px;height:140px;background:#fff;border-radius:18px;box-shadow:inset 0 0 0 1px rgba(60,60,67,.2)"></div>
<div id="round" style="width:120px;height:30px;background:#000;border-radius:16px"></div>
<div id="sheet" style="width:300px;height:70px;background:#000;border-radius:22px 22px 0 0"></div>
</body>`);
await page.addScriptTag({ content: code });
await page.waitForTimeout(200);
const sq = (id) => page.evaluate((id) => { const e = document.getElementById(id); return { key: e.getAttribute("data-rl-sq"), clip: e.style.clipPath, bc: e.style.borderColor, bs: e.style.boxShadow, bg: e.style.backgroundImage }; }, id);

let s = await sq("card");
assert.equal(s.key, "300x120"); assert.match(s.clip, /^path\(/, "a rounded card is smoothed");
for (const id of ["plain", "pill", "circle", "small", "shadow"]) assert.equal((await sq(id)).key, null, id + " is left alone");
s = await sq("round"); assert.equal(s.key, null, "16px corners on a 30px-tall box are a pill at that size: left alone");
s = await sq("sheet"); assert.match(s.clip, /^path\(/, "a sheet's top corners are smoothed");
const sheetPath = await page.evaluate(() => window.relayCorners.shape(300, 70, [22, 22, 0, 0]));
assert.ok(/L 300 70 L 0 70/.test(sheetPath), "its bottom corners stay square");

s = await sq("bordered");
assert.match(s.clip, /^path\(/); assert.equal(s.bc, "transparent", "the CSS border is hidden");
assert.match(decodeURIComponent(s.bg), /stroke="rgb\(204, 204, 204\)" stroke-width="2"/, "and drawn along the smooth edge");
s = await sq("ring");
assert.equal(s.bs, "none", "the inset ring is hidden"); assert.match(decodeURIComponent(s.bg), /stroke="rgba\(60, 60, 67, 0.2\)"/, "and drawn again");

// The smooth corner sits inside the plain rounded one, so nothing new is uncovered.
const inside = await page.evaluate(() => {
  const x = document.createElement("canvas").getContext("2d");
  let out = 0, cut = 0;
  for (const [w, h, r] of [[300, 120, 22], [140, 140, 18], [200, 60, 14], [120, 44, 20]]) {
    const smooth = new Path2D(window.relayCorners.shape(w, h, [r, r, r, r])), plain = new Path2D(); plain.roundRect(0, 0, w, h, r);
    for (let y = 0; y <= h; y += 0.5) for (let xx = 0; xx <= w; xx += 0.5) { const a = x.isPointInPath(smooth, xx, y), b = x.isPointInPath(plain, xx, y); if (a && !b) out++; if (b && !a) cut++; }
  }
  return { out, cut };
});
assert.equal(inside.out, 0, "never outside the CSS rounded corner"); assert.ok(inside.cut > 0, "and the shape really is different");

// Added later, grown, and a border colour that changes.
await page.evaluate(() => { const d = document.createElement("div"); d.id = "later"; d.style.cssText = "width:150px;height:90px;background:#000;border-radius:20px"; document.body.appendChild(d); });
await page.waitForTimeout(150);
assert.equal((await sq("later")).key, "150x90", "something added later is smoothed");
await page.evaluate(() => { document.getElementById("later").style.height = "130px"; });
await page.waitForTimeout(150);
assert.equal((await sq("later")).key, "150x130", "and re-shaped when it grows");
await page.evaluate(() => document.getElementById("bordered").classList.add("on"));
await page.waitForTimeout(150);
assert.match(decodeURIComponent((await sq("bordered")).bg), /stroke="rgb\(199, 245, 103\)"/, "a changed border colour is drawn");
await page.evaluate(() => document.getElementById("bordered").classList.remove("on"));
await page.waitForTimeout(150);
assert.match(decodeURIComponent((await sq("bordered")).bg), /stroke="rgb\(204, 204, 204\)"/, "and changed back");

await browser.close();
console.log("smooth corners: all checks passed");
