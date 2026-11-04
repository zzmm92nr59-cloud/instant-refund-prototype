// Test helper: writes down every request the app makes to Relay's server during a browser test, so
// scripts/test-validation.mjs can check each one against the server's input rules (worker/validate.js).
// Load it in front of any browser test:
//   RELAY_REQUEST_LOG=/tmp/app-requests.jsonl node --import ./scripts/record-app-requests.mjs scripts/test-look-ui.mjs
// It only listens: the test runs exactly as it would without it. Nothing is recorded unless RELAY_REQUEST_LOG is set,
// and if Playwright isn't installed (yet) it does nothing.
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";

const out = process.env.RELAY_REQUEST_LOG;
if (out) {
  let pw = null;
  try { pw = createRequire(import.meta.url)("playwright"); } catch { pw = null; }
  if (pw && pw.chromium && !pw.chromium.__relayRecording) {
    const test = (process.argv[1] || "").split("/").pop();
    const watched = new WeakSet();
    const watch = (ctx) => {
      if (!ctx || watched.has(ctx)) return;
      watched.add(ctx);
      ctx.on("request", (r) => {
        try {
          const u = new URL(r.url());
          // Relay's server: its /relay/ and /plaid/ routes on any host but the test's own page server.
          if (!/^\/(relay|plaid)\//.test(u.pathname) || u.hostname === "127.0.0.1" || u.hostname === "localhost") return;
          if (r.method() === "OPTIONS") return;
          appendFileSync(out, JSON.stringify({ test, method: r.method(), path: u.pathname, search: u.search, body: r.method() === "GET" ? null : r.postData() }) + "\n");
        } catch { /* a request the page abandoned */ }
      });
    };
    const launch = pw.chromium.launch.bind(pw.chromium);
    pw.chromium.launch = async (...args) => {
      const browser = await launch(...args);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...a) => { const ctx = await newContext(...a); watch(ctx); return ctx; };
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async (...a) => { const page = await newPage(...a); watch(page.context()); return page; };
      return browser;
    };
    pw.chromium.__relayRecording = true;
  }
}
