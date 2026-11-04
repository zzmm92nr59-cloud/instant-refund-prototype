// The test-only endpoints left from Relay's first prototype: the Square and Plaid sandbox "test lab", demo stock and the
// old ledger status pages. None of them asks who is calling, several place test payments or register test cards on Relay's
// Square sandbox account, and nothing in the app uses them, so they are switched off: Relay answers "not found", as it
// does for any address it doesn't have. Only the "Existing API and verification tools" testing page used them.
// To switch them back on for a testing session, set LEGACY_TEST_ROUTES = "on" under [vars] in wrangler.toml and deploy
// (and set it back to "off" afterwards).
//
// The prototype endpoints the app still calls stay on: the demo catalogue, the Shopify catalogue and status, the sandbox
// "verified purchases" check and the bank-link demo in the testing tools. They hold no shopper's data and are rate limited
// like everything else.
const EXACT = new Set([
  "/plaid/sandbox-transaction", "/purchases", "/relay/match-test",
  "/relay/live-test", "/relay/live-test/pay", "/relay/returns/sandbox-options", "/relay/demo/inventory"
]);
export function isLegacyTestRoute(path) {
  return EXACT.has(path) || path === "/relay/test-lab" || path.startsWith("/relay/test-lab/") || path.startsWith("/order/") || path.startsWith("/relay/ledger/");
}

export const legacyTestRoutesOn = (env) => Boolean(env && env.LEGACY_TEST_ROUTES === "on");
