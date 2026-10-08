// Compare actual Square Sandbox POS records with the four observed Plaid Sandbox rows.
// Plaid fields are the previously observed test output, not live-linked payment events.
const e=process.env;for(const k of ["SQUARE_ACCESS_TOKEN","CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID"])if(!e[k])throw Error("Missing "+k);
async function api(url,headers,method="GET",body){const r=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok||j.success===false)throw Error(JSON.stringify(j).slice(0,400));return j}
const sql=await api("https://api.cloudflare.com/client/v4/accounts/"+e.CLOUDFLARE_ACCOUNT_ID+"/d1/database/6d3a035f-b869-4e1f-af61-bb34f2f5c51c/query",{"Authorization":"Bearer "+e.CLOUDFLARE_API_TOKEN,"Content-Type":"application/json"},"POST",{sql:"SELECT metadata_json FROM audit_events WHERE event_type='multi_customer_sandbox_test' ORDER BY created_at DESC LIMIT 1"});
const row=sql.result?.[0]?.results?.[0];if(!row)throw Error("No prior Square customer run");
const orders=JSON.parse(row.metadata_json).orders;
const plaid=[{customer:"Ava",amount:15999,name:"NORTH & CO",date:"2026-10-08"},{customer:"Ben",amount:8999,name:"NORTH & CO",date:"2026-10-08"},{customer:"Cara",amount:15999,name:"NORTH & CO",date:"2026-10-08"},{customer:"Dylan",amount:15999,name:"NORTH & CO",date:"2026-10-08"}];
const squareHeaders={"Authorization":"Bearer "+e.SQUARE_ACCESS_TOKEN,"Square-Version":"2026-09-16","Content-Type":"application/json"};
const result=[];
for(const o of orders){const p=await api("https://connect.squareupsandbox.com/v2/payments/"+encodeURIComponent(o.paymentId),squareHeaders);const x=p.payment,card=x.card_details?.card||{};const candidates=plaid.filter(b=>b.amount===x.amount_money?.amount);
 result.push({expectedCustomer:o.customer,product:o.item,variant:o.variation,amountMinor:x.amount_money?.amount,
  squareLocationId:x.location_id, squarePaymentCreatedAt:x.created_at, squareCardBrand:card.card_brand||null,
  squareCardLast4:card.last_4||null, squareCardFingerprintPresent:!!card.fingerprint,
  plaidCandidates:candidates.map(c=>c.customer),plaidCardLast4Available:false,plaidExactTimeAvailable:false,
  plaidLocationAvailable:false,ownershipVerified:false});
}
console.log(JSON.stringify({source:"Real Square Sandbox payments compared with previously observed Plaid Sandbox transaction fields",result},null,2));
