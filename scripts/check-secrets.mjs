// Looks for API keys, tokens and private keys written into Relay's code (OWASP: secrets never live in source control;
// the repository is public, and everything in the app's own files is sent to every visitor's browser).
// Relay's keys live only as Cloudflare Worker secrets (put there by .github/workflows/deploy-worker.yml from GitHub's
// encrypted secrets, or set in Cloudflare directly), and the server reads them from env at run time.
//
//   node scripts/check-secrets.mjs            every file in the repository as it is now
//   node scripts/check-secrets.mjs --history  every line ever committed, on every branch (slower)
//
// Anything found is shown masked (its first few characters and length), never in full, and the check fails.
// Made-up values in tests (with "fake", "example", "unit-test", 1234567890 and the like in them) are allowed.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = {
  "Stripe secret or restricted key": /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  "Stripe webhook secret": /\bwhsec_[A-Za-z0-9]{16,}/g,
  "Square access token": /\bEAAA[A-Za-z0-9_-]{30,}/g,
  "Square application secret": /\bsq0csp-[A-Za-z0-9_-]{20,}/g,
  "Square OAuth token": /\bsq0atp-[A-Za-z0-9_-]{20,}/g,
  "Google API key": /\bAIza[0-9A-Za-z_-]{35}/g,
  "Google OAuth client secret": /\bGOCSPX-[A-Za-z0-9_-]{20,}/g,
  "Shopify token or secret": /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{20,}/g,
  "Resend API key": /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g,
  "Twilio API key": /\bSK[0-9a-fA-F]{32}\b/g,
  "AWS access key": /\bAKIA[0-9A-Z]{16}\b/g,
  "GitHub token": /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  "Slack token": /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  "Private key": /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  "Signed token (JWT)": /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g,
  "Secret written into code": /\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)|secret|apiKey|api_key|accessToken|authToken|password)\s*[:=]\s*["'`]([A-Za-z0-9_\-/+=.]{20,})["'`]/g
};
// Made-up values used by tests and examples.
const FAKE = /fake|dummy|example|placeholder|unit-?test|test-?secret|not-?a-?real|changeme|1234567890|0123456789|abcdefghij|xxxxxx|000000/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|pdf|zip|gz|mp4|mov|webm|mp3|wav)$/i;

const mask = (s) => s.slice(0, 6) + "… (" + s.length + " characters)";
function scan(text, where, found) {
  for (const [name, re] of Object.entries(PATTERNS)) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const value = m[1] || m[0];
      if (FAKE.test(value) || FAKE.test(m[0])) continue;
      const line = text.slice(0, m.index).split("\n").length;
      found.push(where(line) + "  " + name + ": " + mask(value));
    }
  }
}

const found = [];
if (process.argv.includes("--history")) {
  const log = execFileSync("git", ["log", "--all", "-p", "--no-color", "--unified=0"], { maxBuffer: 1 << 30 }).toString("utf8");
  let commit = "?";
  for (const ln of log.split("\n")) {
    if (ln.startsWith("commit ")) commit = ln.slice(7, 15);
    else if (ln.startsWith("+") && !ln.startsWith("+++")) scan(ln, () => "commit " + commit, found);
  }
} else {
  const files = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
  for (const f of files) {
    if (BINARY.test(f)) continue;
    let text;
    try { if (statSync(f).size > 4 * 1024 * 1024) continue; text = readFileSync(f, "utf8"); } catch { continue; }
    scan(text, (line) => f + ":" + line, found);
  }
  // Plain-text settings in wrangler.toml are public: only names that aren't secrets belong there.
  const toml = readFileSync("worker/wrangler.toml", "utf8");
  const vars = (/\[vars\]([\s\S]*?)(?:\n\[|$)/.exec(toml) || [, ""])[1];
  for (const m of vars.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm))
    if (/SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/.test(m[1])) found.push("worker/wrangler.toml  " + m[1] + " is a secret's name under [vars]: use `wrangler secret put` instead");
}

if (found.length) {
  console.error("Possible secrets found (" + found.length + "). Remove them, rotate each key at its service, and keep the new one as a Cloudflare secret:");
  for (const f of [...new Set(found)].slice(0, 50)) console.error("  " + f);
  process.exit(1);
}
console.log("PASS no keys, tokens or private keys in " + (process.argv.includes("--history") ? "any commit" : "the repository's files"));
