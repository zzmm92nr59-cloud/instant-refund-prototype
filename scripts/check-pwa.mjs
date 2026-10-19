// Offline checks that Relay stays installable as a home-screen app. No network needed.
import fs from "node:fs";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const manifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(manifest.display, "standalone");
assert.ok(manifest.name && manifest.short_name && manifest.start_url && manifest.scope);
const pngSize = (p) => { const b = fs.readFileSync(new URL(p, root)); assert.equal(b.toString("latin1", 1, 4), "PNG", p + " is not a PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
for (const icon of manifest.icons) {
  const [w, h] = pngSize(icon.src);
  assert.equal(`${w}x${h}`, icon.sizes, icon.src + " size does not match the manifest");
}
assert.ok(manifest.icons.some((i) => i.sizes === "192x192"), "needs a 192px icon");
assert.ok(manifest.icons.some((i) => i.sizes === "512x512"), "needs a 512px icon");
assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "needs a maskable icon");
assert.deepEqual(pngSize("icons/apple-touch-icon.png"), [180, 180]);
for (const page of ["index.html", "relay-app-v2.html"]) {
  const html = read(page);
  for (const needle of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', 'src="pwa-register.js"', "viewport-fit=cover"])
    assert.ok(html.includes(needle), page + " is missing " + needle);
}
assert.equal(read("index.html"), read("relay-app-v2.html"), "index.html and relay-app-v2.html must stay identical");
const sw = read("sw.js");
assert.match(sw, /url\.origin !== self\.location\.origin\) return/, "service worker must never touch cross-origin (API) requests");
assert.match(sw, /req\.method !== "GET"\) return/, "service worker must ignore non-GET requests");
console.log("PASS PWA manifest, icons, page links and service worker safety rules");
