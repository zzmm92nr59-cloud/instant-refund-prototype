// One-click isolated multi-customer Square Sandbox test. No real charges.
// A Square order is merchant data; synthetic bank records are NOT real bank ownership proof.
const sqToken=process.env.SQUARE_ACCESS_TOKEN,cfToken=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID,dbid="6d3a035f-b869-4e1f-af61-bb34f2f5c51c";
if(!sqToken||!cfToken||!account)throw Error("Missing Square/Cloudflare GitHub Actions secrets");
async function request(url,token,method="GET",body){
 const r=await fetch(url,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(url.includes("squareupsandbox")?{"Square-Version":"2026-09-16"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();if(!r.ok||j.success===false||j.errors?.length)throw Error(url+" "+JSON.stringify(j.errors||j).slice(0,300));return j;
}
const sq=(p,m,b)=>request("https://connect.squareupsandbox.com"+p,sqToken,m,b);
const sql=async(q,params=[])=>{const x=await request("https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database/"+dbid+"/query",cfToken,"POST",{sql:q,params});if(x.result?.[0]?.success===false)throw Error(JSON.stringify(x.result[0]));return x.result?.[0]?.results||[]};
const locations=(await sq("/v2/locations")).locations.filter(x=>x.status==="ACTIVE");
const location=locations[0];if(!location)throw Error("No Square location");
const cat=await sq("/v2/catalog/list?types=ITEM&limit=100");
const variants=(cat.objects||[]).flatMap(item=>(item.item_data?.variations||[]).map(v=>({id:v.id,name:item.item_data.name,variation:v.item_variation_data?.name,price:v.item_variation_data?.price_money?.amount}))).filter(v=>v.price>0&&v.name?.includes("Relay Demo"));
if(variants.length<3)throw Error("At least three priced Relay Demo variations needed");
const run=crypto.randomUUID(),customers=["Ava","Ben","Cara","Dylan"];
const scenarios=[
 {customer:0,variation:variants[0],reference:"ref-"+run+"-A",last4:"1111"},
 {customer:1,variation:variants[1],reference:"ref-"+run+"-B",last4:"2222"},
 {customer:2,variation:variants[2],reference:"ref-"+run+"-C",last4:"1111"},
 {customer:3,variation:variants[0],reference:null,last4:"1111"}
];
const output=[];
for(let i=0;i<scenarios.length;i++){
 const t=scenarios[i];
 const o=(await sq("/v2/orders","POST",{idempotency_key:crypto.randomUUID(),order:{location_id:location.id,reference_id:"relay-multi-"+run.slice(0,8)+"-"+i,line_items:[{quantity:"1",catalog_object_id:t.variation.id}]}})).order;
 // Use Square's sandbox-only nonce to create an actual completed payment.
 const payment=(await sq("/v2/payments","POST",{source_id:"cnon:card-nonce-ok",idempotency_key:crypto.randomUUID(),amount_money:o.total_money,order_id:o.id,location_id:location.id,autocomplete:true})).payment;
 if(payment.status!=="COMPLETED")throw Error("Sandbox payment incomplete "+o.id);
 const actualBrand=payment.card_details?.card?.card_brand||null,actualLast4=payment.card_details?.card?.last_4||null;
 output.push({customer:customers[t.customer],orderId:o.id,item:t.variation.name,variation:t.variation.variation,amount:o.total_money.amount,
  reference:t.reference,simulatedBankCardLast4:t.last4,actualSquareCardLast4:actualLast4,actualSquareCardBrand:actualBrand,paymentId:payment.id});
}
const bank=output.map((o,i)=>({consumer:customers[i],amount:o.amount,merchant:"North & Co.",reference:o.reference,
 cardLast4:o.simulatedBankCardLast4}));
const decisions=output.map(o=>{
 const plausible=bank.filter(b=>b.amount===o.amount&&b.merchant==="North & Co.");
 const refMatches=plausible.filter(b=>o.reference&&b.reference===o.reference);
 const candidate=refMatches.length===1?refMatches[0]:null;
 return {orderId:o.orderId,item:o.item,variation:o.variation,expectedCustomer:o.customer,
 candidateCustomer:candidate?.consumer||null,status:candidate?"STRONG_SIMULATED_CANDIDATE":"UNRESOLVED",
 evidence:candidate?["synthetic_unique_payment_reference","amount","merchant"]:["amount","merchant"],
 ownershipVerified:false,reason:"Synthetic bank references were not obtained from real Square-to-bank payment rails"};
});
const report={run,createdAt:new Date().toISOString(),environment:"square_sandbox",customerCount:customers.length,orders:output,decisions,
 falseAssignments:decisions.filter(d=>d.candidateCustomer&&d.candidateCustomer!==d.expectedCustomer).length,
 verifiedWalletPurchases:0};
await sql("INSERT INTO audit_events(id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)",
 [crypto.randomUUID(),"system","github_actions","multi_customer_sandbox_test","simulation",run,JSON.stringify(report)]);
console.log(JSON.stringify({run,orders:output.map(o=>({customer:o.customer,orderId:o.orderId,item:o.item,variation:o.variation})),decisions,falseAssignments:report.falseAssignments},null,2));
