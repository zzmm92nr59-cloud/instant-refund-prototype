// Which Square Relay talks to. Sandbox (test shops) unless the server setting SQUARE_ENVIRONMENT is "production".
// Production also needs Relay's production Square app: SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET (kept as server secrets).
// The data Square returns is the same in both, so nothing else about reading catalogues, pictures or stock changes.
export const SANDBOX_APP_ID = "sandbox-sq0idb-S-JwqxshuoQuUVeJdZ6HBw"; // public identifier of Relay's Sandbox app, not a secret
export function squareIsProduction(env) { return String(env && env.SQUARE_ENVIRONMENT || "").toLowerCase() === "production"; }
export function squareHost(env) { return squareIsProduction(env) ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"; }
export function squareAppId(env) {
  if (squareIsProduction(env)) return env.SQUARE_APPLICATION_ID || null; // never fall back to the Sandbox app in production
  return env.SQUARE_APPLICATION_ID || SANDBOX_APP_ID;
}
// The name to show for a Square shop. Square's test accounts are called things like "Default Test Account",
// which means nothing to a shopper, so those use Relay's label for its demo shop instead.
const PLACEHOLDER = /^(default test account|sandbox seller|test account|my business)\b/i;
export function squareShopName(env, raw) {
  const name = String(raw || "").trim();
  return name && !PLACEHOLDER.test(name) ? name : (env && env.SQUARE_DEFAULT_LABEL) || "Relay Demo Store";
}
