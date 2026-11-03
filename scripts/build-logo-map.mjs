// Writes the app's list of the logos Relay keeps (account.js: STORE_LOGOS, LOGO_ALIASES) from the files in logos/ and
// scripts/uk-store-aliases.json. Run after the "Fetch store logos" workflow or after removing a logo by hand:
//   node scripts/build-logo-map.mjs
import fs from "node:fs";
const files = fs.readdirSync("logos").filter(f => !f.startsWith("_") && /\.(png|svg|ico|jpg|webp|gif)$/.test(f)).sort();
const map = {};
for (const f of files) { const m = /^(.+)\.(png|svg|ico|jpg|webp|gif)$/.exec(f); if (m && !map[m[1]]) map[m[1]] = m[2]; }
const aliases = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync("scripts/uk-store-aliases.json", "utf8"))).filter(([, to]) => map[to]));
let src = fs.readFileSync("account.js", "utf8");
const line = /^  \/\/ Logos [^\n]*\n  var STORE_LOGOS = \{[^\n]*\};\n(  \/\/ [^\n]*\n  var LOGO_ALIASES = \{[^\n]*\};\n)?/m;
if (!line.test(src)) throw new Error("STORE_LOGOS line not found in account.js");
src = src.replace(line, "  // Logos Relay keeps for well-known UK shops (logos/<domain>.<type>; see scripts/fetch-logos.mjs). Anything else falls back to a live lookup.\n" +
  "  var STORE_LOGOS = " + JSON.stringify(map) + ";\n" +
  "  // Other addresses the same shops send email from (just-eat.com is Just Eat's just-eat.co.uk).\n" +
  "  var LOGO_ALIASES = " + JSON.stringify(aliases) + ";\n");
fs.writeFileSync("account.js", src);
console.log(Object.keys(map).length + " logos, " + Object.keys(aliases).length + " other addresses");
