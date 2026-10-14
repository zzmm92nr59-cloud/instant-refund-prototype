import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match, "Relay app must have an inline script");
const script = match[1];
new vm.Script(script, { filename: "index.html embedded JavaScript" });

const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) {
    nodes.set(id, {
      id, innerHTML: "", textContent: "", value: "", className: "",
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, querySelectorAll() { return []; },
      querySelector() { return { textContent: "" }; }, style: {},
    });
  }
  return nodes.get(id);
}
const location = { search: "", href: "", hash: "" };
const win = { scrollTo() {}, location };
const localStorage = { getItem: () => null, setItem() {} };
const catalogue = {
  products: [
    { sku: "DEMO-TR-8", product: "Retro High Trainers", variation: "UK 8", priceMinor: 12999, currency: "GBP" },
    { sku: "DEMO-TS-M", product: "Boxy Cotton Tee", variation: "Medium", priceMinor: 2899, currency: "GBP" },
  ],
};
const context = vm.createContext({
  document: { getElementById: node, querySelectorAll: () => [], createElement: () => node("new") },
  window: win, location, localStorage, URLSearchParams, Date, console, alert() {},
  fetch: async (url) => url.includes("/live-test/products")
    ? { ok: true, status: 200, json: async () => catalogue }
    : { ok: false, status: 403, json: async () => ({}) },
});
new vm.Script(script).runInContext(context);

const screen = () => node("view").innerHTML;
const verifyHandlers = (screenName) => {
  const markup = screen();
  const handlers = [...markup.matchAll(/\bonclick="([^"]*)"/g)];
  for (const [, code] of handlers) {
    new vm.Script("(function(){" + code + "})", { filename: screenName + " onclick" });
  }
};
function check(name, expected) {
  win.go(name);
  assert.ok(screen().includes(expected), name + " failed to render expected content");
  assert.ok(node("side").innerHTML.includes('go(\'' + name + '\')'), name + " navigation missing");
  verifyHandlers(name);
  console.log("PASS", name);
}
assert.ok(screen().includes("Your purchases"), "Wallet failed to start");
assert.ok(screen().includes("Free for everyone"), "Default Free membership missing");
verifyHandlers("wallet");
for (const [name, expected] of [
  ["wallet", "Recent purchases"],
  ["discover", "RELAY DISCOVER"],
  ["radar", "RELAY RADAR"],
  ["wrapped", "RELAY WRAPPED"],
  ["profile", "Your Relay profile"],
]) check(name, expected);

// Exercise the browser-style global inline handler, not just a direct JS function call.
win.go("wallet");
win.toggleDemo(); // off
assert.equal(win.demo, false, "Demo toggle failed to turn off");
Object.defineProperties(context, {
  demo: { get: () => win.demo, set: value => { win.demo = value; }, configurable: true },
  page: { get: () => win.page, set: value => { win.page = value; }, configurable: true },
  reason: { get: () => win.reason, set: value => { win.reason = value; }, configurable: true },
  exchangeContext: { get: () => win.exchangeContext, set: value => { win.exchangeContext = value; }, configurable: true },
});
Object.assign(context, { openPurchase: win.openPurchase, render: win.render, go: win.go });
new vm.Script("demo=true;openPurchase('sample-1')").runInContext(context);
assert.equal(win.demo, true, "Demo click did not restore demo mode");
assert.ok(screen().includes("Retro High Trainers"), "Demo purchase button did not open item");
new vm.Script("page='refund';render()").runInContext(context);
assert.ok(screen().includes("Return for free"), "Free must not promise an early refund");
win.setPlanPreview("plus");
assert.ok(screen().includes("SIMULATED EARLY OFFER"), "Plus preview must show the simulated early refund offer");
new vm.Script("page='exchange';render()").runInContext(context);
assert.ok(screen().includes("Reason for exchange"), "Exchange click did not open options");
new vm.Script("exchangeContext=true;go('discover')").runInContext(context);
assert.ok(screen().includes("Find the right replacement"), "Discover exchange link did not set context");
console.log("PASS Free return-first, Plus demo, in-page exchange and contextual Discover clicks");

win.openPurchase("sample-1");
assert.ok(screen().includes("Retro High Trainers"), "Demo purchase details missing");
verifyHandlers("purchase");
for (const [name, expected] of [
  ["refund", "SIMULATED"],
  ["exchange", "exchange"],
]) {
  win.page = name;
  win.render();
  assert.ok(screen().toLowerCase().includes(expected.toLowerCase()), name + " screen failed");
  verifyHandlers(name);
  console.log("PASS", name);
}
console.log("Relay JavaScript parses; core screens and dynamic button handlers pass.");
