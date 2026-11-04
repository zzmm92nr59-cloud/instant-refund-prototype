// Test helper: every route address Relay's server mentions, read from its own code, so tests can try each one.
// Gives each "/relay/my/...", "/relay/auth/..." and "/relay/retailer/..." string in worker/*.js, and a sample address for each
// route pattern (an id filled in, and each choice of an (a|b) part).
import { readFileSync, readdirSync } from "node:fs";

const SAMPLES = ["11111111-1111-4111-8111-111111111111", "abcd1234efgh", "example.com", "p-1", "a"];

function samplesOf(src) {
  const whole = new RegExp("^" + src + "$");
  let outs = [""];
  for (let i = 0; i < src.length;) {
    if (src[i] === "\\") { outs = outs.map(o => o + src[i + 1]); i += 2; continue; }
    if (src[i] === "(") {
      const j = src.indexOf(")", i), g = src.slice(i + 1, j); i = j + 1;
      const alts = /^[A-Za-z_|-]+$/.test(g) ? g.split("|") : [SAMPLES.find(c => new RegExp("^(?:" + g + ")$").test(c)) || "x"];
      outs = outs.flatMap(o => alts.map(a => o + a));
      continue;
    }
    outs = outs.map(o => o + src[i]); i++;
  }
  return outs.filter(o => whole.test(o));
}

export function serverRoutes(dir = "worker") {
  const sources = readdirSync(dir).filter(f => f.endsWith(".js")).map(f => readFileSync(dir + "/" + f, "utf8"));
  const found = new Set(["/relay/me"]);
  for (const src of sources) {
    for (const m of src.matchAll(/"(\/relay\/(?:my|auth|retailer)\/[A-Za-z0-9/_.-]*)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/\/\^(\\\/relay\\\/(?:my|auth|retailer)\\\/[^\n]*?)\$\//g)) for (const p of samplesOf(m[1])) found.add(p);
  }
  return { routes: [...found].sort(), sources };
}
