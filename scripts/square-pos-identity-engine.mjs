// Relay POS identity decision engine. Safe by default: never release an order on card digits, // purchase amount, or an unclaimed Square profile alone.
// Pure module used by the node tests and optional future backend implementation.
export function decidePosOwner(payment, anchors = []) {
  const merchantId = String(payment.merchantId || "").trim();
  const customerId = String(payment.customerId || "").trim();
  const fingerprint = String(payment.fingerprint || "").trim();
  if (!merchantId || !payment.orderId || !payment.paymentId) return {status:"WITHHELD",reason:"Incomplete Square payment identity"};
  // Anchor must have been independently proved through an authenticated retailer account,
  // merchant-confirmed customer link, or a secure one-time claim of the specific order.
  const valid = anchors.filter(a => a.merchantId === merchantId && a.verified === true &&
    typeof a.relayConsumerId === "string" && a.relayConsumerId.length > 0 &&
    typeof a.proof === "string" &&
    ["retailer_account_verified","retailer_customer_verified","order_claim_verified"].includes(a.proof));
  const byCustomer = customerId ? valid.filter(a => a.squareCustomerId === customerId) : [];
  const byFingerprint = fingerprint ? valid.filter(a => a.squareFingerprint === fingerprint) : [];
  const candidates = [...new Set([...byCustomer,...byFingerprint].map(a => a.relayConsumerId))];
  if (!candidates.length) return {status:"UNCLAIMED",reason:"No verified first-purchase link for this Square merchant; require customer claim"};
  if (candidates.length !== 1) return {status:"CONFLICT",reason:"Square identifiers link to different verified Relay customers"};
  const owner = candidates[0];
  // An anchor that explicitly links another consumer to the same identifier defeats ownership.
  if (byCustomer.some(a=>a.relayConsumerId!==owner) || byFingerprint.some(a=>a.relayConsumerId!==owner))
    return {status:"CONFLICT",reason:"Conflicting verified identity associations"};
  // When both identifiers are available, disagreement must never be silently resolved.
  if (customerId && fingerprint && byCustomer.length && byFingerprint.length &&
      byCustomer.some(a => !byFingerprint.some(b => b.relayConsumerId===a.relayConsumerId)))
    return {status:"CONFLICT",reason:"Square customer and card identity disagree"};
  // For stronger safety, auto-release only on the VERIFIED Square customer link;
  // fingerprints can suggest another candidate but don't independently prove ownership.
  if (!byCustomer.length) return {status:"REVIEW",relayConsumerId:owner,reason:"Repeat card fingerprint matches an anchor, but Square customer_id is not verified for this payment"};
  return {status:"LINKED",relayConsumerId:owner,reason:"Merchant-scoped Square customer_id maps to one independently verified Relay customer; server-side authorization still required"};
}
export function fingerprintGroups(payments) {
  const groups = new Map();
  for (const p of payments) {
    if (!p.merchantId || !p.fingerprint) continue;
    const k = p.merchantId+"|"+p.fingerprint;
    const group = groups.get(k)||{merchantId:p.merchantId,count:0,customerIds:new Set(),paymentIds:[]};
    group.count++;if(p.customerId)group.customerIds.add(p.customerId);
    group.paymentIds.push(p.paymentId);groups.set(k,group);
  }
  return [...groups.values()].map(g=>({merchantId:g.merchantId,paymentCount:g.count,squareCustomerIdCount:g.customerIds.size,customerIdConflict:g.customerIds.size>1,paymentIds:g.paymentIds}));
}
