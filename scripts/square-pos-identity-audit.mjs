// Read-only audit of existing Square Sandbox payment records. Prints no raw fingerprints,
// customer contact information, access tokens, full bank records, or personal data.
// Can run in GitHub Actions with the existing SQUARE_ACCESS_TOKEN secret.
import {createHash} from "node:crypto";
import {fingerprintGroups} from "./square-pos-identity-engine.mjs";
const env=process.env;
if(!env.SQUARE_ACCESS_TOKEN)throw Error("SQUARE_ACCESS_TOKEN secret is missing");
const squareBase="https://connect.squareupsandbox.com",cloudBase="https://api.cloudflare.com/client/v4/accounts/";
const squareHeaders={Authorization:"Bearer "+env.SQUARE_ACCESS_TOKEN,"Square-Version":"2026-09-16",Accept:"application/json"};
const pseudonym=x=>x?createHash("sha256").update(String(x)).digest("hex").slice(0,12):null;
async function json(url,options={}){const r=await fetch(url,options);const j=await r.json();if(!r.ok||j.errors?.length||j.success===false)throw Error("API "+r.status+" at "+new URL(url).pathname+" : "+JSON.stringify(j.errors||j).slice(0,250));return j}
const sq=p=>json(squareBase+p,{headers:squareHeaders});
let locationIds=[],merchantId="unknown-sandbox-merchant";
try{const locations=(await sq("/v2/locations")).locations||[];locationIds=locations.map(x=>x.id);merchantId=locations.find(x=>x.merchant_id)?.merchant_id||merchantId}catch(e){console.log("Location inspection unavailable:",e.message)}
const targetIds=new Set();
if(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID){
 try{
   const url=cloudBase+env.CLOUDFLARE_ACCOUNT_ID+"/d1/database/6d3a035f-b869-4e1f-af61-bb34f2f5c51c/query";
   const d=await json(url,{method:"POST",headers:{Authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({sql:"SELECT metadata_json FROM audit_events WHERE event_type IN ('coordinated_square_plaid_test','multi_customer_sandbox_test') ORDER BY created_at DESC LIMIT 4"})});
   for(const row of d.result?.[0]?.results||[]){
      const data=JSON.parse(row.metadata_json||"{}");
      for(const x of [...(data.results||[]),...(data.orders||[])]){const id=x.square?.paymentId||x.paymentId;if(id)targetIds.add(id)}
   }
 }catch(e){console.log("Past run IDs unavailable; will inspect recent Square payments:",e.message)}
}
const payments=[];
for(const id of [...targetIds].slice(0,30)){
 try{const p=(await sq("/v2/payments/"+encodeURIComponent(id))).payment;if(p)payments.push(p)}
 catch(e){console.log("A prior test payment is unavailable:",e.message)}
}
const seen=new Set(payments.map(p=>p.id));
try{
 let cursor=null;
 for(let i=0;i<3;i++){
  const url="/v2/payments?limit=100"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
  const data=await sq(url);
  for(const p of data.payments||[])if(!seen.has(p.id)){payments.push(p);seen.add(p.id)}
  cursor=data.cursor;if(!cursor)break;
 }
}catch(e){console.log("Recent payments unavailable:",e.message)}
const cards=payments.filter(p=>p.source_type==="CARD"&&p.status==="COMPLETED");
const normalized=cards.map(p=>({merchantId,orderId:p.order_id||null,paymentId:p.id,
  customerId:p.customer_id||null,fingerprint:p.card_details?.card?.fingerprint||null,
  last4:p.card_details?.card?.last_4||null,brand:p.card_details?.card?.card_brand||null,
  entryMethod:p.card_details?.entry_method||null,locationId:p.location_id||null,createdAt:p.created_at||null,
  receipt:p.receipt_url?true:false,buyerEmailPresent:!!p.buyer_email_address}));
const customerIds=[...new Set(normalized.map(x=>x.customerId).filter(Boolean))];
const profiles={};for(const id of customerIds.slice(0,25)){
 try{const c=(await sq("/v2/customers/"+encodeURIComponent(id))).customer;profiles[id]={source:c?.creation_source||"unknown",emailPresent:!!c?.email_address,phonePresent:!!c?.phone_number}}
 catch(e){profiles[id]={unavailable:true}}
}
const grouped=fingerprintGroups(normalized);
const output={
 inspection:"REAL_SQUARE_SANDBOX_READ_ONLY",timestamp:new Date().toISOString(),
 inspectedCardPayments:normalized.length,merchantTag:pseudonym(merchantId),locations:locationIds.length,
 signals:{
  fingerprintAvailable:normalized.filter(p=>p.fingerprint).length,
  customerIdAvailable:normalized.filter(p=>p.customerId).length,
  squareOrderIdAvailable:normalized.filter(p=>p.orderId).length,
  lastFourAvailable:normalized.filter(p=>p.last4).length,
  buyerEmailAvailable:normalized.filter(p=>p.buyerEmailPresent).length,
  repeatFingerprintGroups:grouped.filter(g=>g.paymentCount>1).length,
  conflictingSquareProfilesOnOneFingerprint:grouped.filter(g=>g.customerIdConflict).length
 },
 samplePayments:normalized.slice(0,35).map(p=>({paymentTag:pseudonym(p.paymentId),orderTag:pseudonym(p.orderId),customerTag:pseudonym(p.customerId),
 fingerprintTag:pseudonym(p.fingerprint),cardLast4:p.last4,cardBrand:p.brand,
 entryMethod:p.entryMethod,locationTag:pseudonym(p.locationId),
 buyerEmailPresent:p.buyerEmailPresent,profile:p.customerId?profiles[p.customerId]||null:null})),
 conclusions:{
  authenticatedRelayLinksFound:0,
  autoVerifiedRelayPurchases:0,
  outcome:"IDENTIFIER_AVAILABILITY_ONLY",
  note:"Square merchant-scoped fingerprints and customer IDs cannot identify a Relay account without a separately authenticated link. Repeated sandbox nonce 5858 is not four independent buyers."
 }
};
console.log(JSON.stringify(output,null,2));
