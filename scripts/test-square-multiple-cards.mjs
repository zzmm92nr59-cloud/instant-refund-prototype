// Relay diagnostic only: create four Square SANDBOX card-not-present payments using
// distinct documented test sources. No purchase order or Relay wallet claim is created.
// Never use a production access token or use these outcomes as buyer verification.
import { createHash, randomUUID } from "node:crypto";

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) throw Error("SQUARE_ACCESS_TOKEN GitHub secret is missing");
const base = "https://connect.squareupsandbox.com";
const headers = {
  Authorization: "Bearer " + token,
  "Square-Version": "2026-09-16",
  "Content-Type": "application/json"
};
const sources = [
  {label:"Ava", source:"cnon:card-nonce-ok", description:"API generic test card"},
  {label:"Ben", source:"ccof:customer-card-id-visa-ok", description:"Visa card-on-file test"},
  {label:"Cara", source:"ccof:customer-card-id-mastercard-ok", description:"Mastercard card-on-file test"},
  {label:"Dylan", source:"ccof:customer-card-id-american-express-ok", description:"Amex card-on-file test"}
];

async function call(path, options={}) {
  const response = await fetch(base+path,{...options,headers});
  let data;
  try { data=await response.json() } catch { data={message:"Non-JSON response"} }
  return {ok:response.ok && !(data.errors||[]).length, status:response.status, data};
}
const loc = await call("/v2/locations");
if (!loc.ok) throw Error("Unable to read Sandbox locations: HTTP "+loc.status);
const locations=(loc.data.locations||[]).filter(l=>l.status==="ACTIVE");
const location = locations[0]?.id;
if (!location) throw Error("No active Square Sandbox location found");

const tag=value=>value?createHash("sha256").update(String(value)).digest("hex").slice(0,12):null;
const results=[];
for (const {label,source,description} of sources) {
  // Same amount/store in every case deliberately stresses card differentiation.
  // Payments are isolated diagnostics without order_id, so they are not wallet purchases.
  const body = {
    idempotency_key:randomUUID(),
    source_id:source,
    amount_money:{amount:12999,currency:"GBP"},
    location_id:location,
    autocomplete:true,
    note:"RELAY SANDBOX CARD IDENTITY DIAGNOSTIC - NO RETAILER ORDER"
  };
  const response=await call("/v2/payments",{
    method:"POST",body:JSON.stringify(body)
  });
  if (!response.ok) {
    const errors=(response.data.errors||[]).map(e=>({
      code:e.code,category:e.category,detail:String(e.detail||"").slice(0,120)
    }));
    results.push({testCustomer:label,sourceType:description,status:"REJECTED",httpStatus:response.status,errors});
    continue;
  }
  const p=response.data.payment||{};
  const card=p.card_details?.card||{};
  results.push({
    testCustomer:label,
    sourceType:description,
    status:p.status||"UNKNOWN",
    paymentTag:tag(p.id),
    cardBrand:card.card_brand||null,
    last4:card.last_4||null,
    fingerprintTag:tag(card.fingerprint),
    paymentCreatedAt:p.created_at||null,
    squareCustomerIdPresent:!!p.customer_id,
    squareOrderIdPresent:!!p.order_id
  });
}
const successful=results.filter(r=>r.status==="COMPLETED");
const distinctFingerprints=new Set(successful.map(r=>r.fingerprintTag).filter(Boolean)).size;
const distinctCardCombos=new Set(successful.map(r=>r.cardBrand+"|"+r.last4).filter(x=>!x.includes("null"))).size;
const outcome = successful.length<2 ? "INSUFFICIENT_SUCCESSFUL_SOURCES"
  : distinctFingerprints>1 ? "DISTINCT_SQUARE_CARD_FINGERPRINTS_OBSERVED"
  : distinctCardCombos>1 ? "DISTINCT_BRAND_LAST4_OBSERVED_FINGERPRINTS_NOT_DISTINCT"
  : "SOURCES_COLLAPSE_TO_SAME_CARD_IDENTITY";
console.log(JSON.stringify({
  test:"RELAY_SQUARE_SANDBOX_MULTIPLE_CARD_SOURCES",
  environment:"Square Sandbox only",
  method:"Square API generic token and documented card-on-file test source IDs",
  isCardPresentPOS:false,
  amountMinor:12999,currency:"GBP",
  note:"No order_id and no authenticated Relay customer links. Labels Ava/Ben/Cara/Dylan are simulation labels, not identities asserted by Square.",
  successfulPaymentCount:successful.length,
  uniqueFingerprintCount:distinctFingerprints,
  uniqueBrandLast4Count:distinctCardCombos,
  outcome,results
},null,2));
if (successful.length===0) process.exitCode=1;
