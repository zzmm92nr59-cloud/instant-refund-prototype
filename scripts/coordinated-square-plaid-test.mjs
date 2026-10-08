// Coordinated Square/Plaid Sandbox test. Never claims customer ownership from synthetic data.
const env=process.env;for(const k of ["SQUARE_ACCESS_TOKEN","PLAID_CLIENT_ID","PLAID_SECRET"])if(!env[k])throw Error("Missing "+k);
async function call(url,headers,body){const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});const j=await r.json();if(!r.ok||j.errors?.length)throw Error(url+" "+JSON.stringify(j).slice(0,450));return j}
const sqHeaders={Authorization:"Bearer "+env.SQUARE_ACCESS_TOKEN,"Content-Type":"application/json","Square-Version":"2026-09-16"};
const plHeaders={"Content-Type":"application/json","PLAID-CLIENT-ID":env.PLAID_CLIENT_ID,"PLAID-SECRET":env.PLAID_SECRET};
const sq=(path,body)=>call("https://connect.squareupsandbox.com"+path,sqHeaders,body);
const pl=(path,body)=>call("https://sandbox.plaid.com"+path,plHeaders,body);
const loc=await (await fetch("https://connect.squareupsandbox.com/v2/locations",{headers:sqHeaders})).json();
const location=loc.locations?.find(x=>x.status==="ACTIVE");if(!location)throw Error("No active Square location");
const cat=await (await fetch("https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM&limit=100",{headers:sqHeaders})).json();
const vars=(cat.objects||[]).flatMap(x=>(x.item_data?.variations||[]).map(v=>({id:v.id,name:x.item_data.name,variant:v.item_variation_data?.name,price:v.item_variation_data?.price_money?.amount}))).filter(x=>x.name?.includes("Relay Demo")&&x.price>0);
if(vars.length<3)throw Error("Need at least three Square demo variants");
const people=["Ava","Ben","Cara","Dylan"],today=new Date().toISOString().slice(0,10),run=crypto.randomUUID();
const results=[];
for(let i=0;i<4;i++){
 const variation=vars[i===3?0:i%vars.length];
 const order=(await sq("/v2/orders",{idempotency_key:crypto.randomUUID(),order:{location_id:location.id,reference_id:"relay-coordinated-"+run.slice(0,8)+"-"+i,line_items:[{quantity:"1",catalog_object_id:variation.id}]}})).order;
 const payment=(await sq("/v2/payments",{source_id:"cnon:card-nonce-ok",idempotency_key:crypto.randomUUID(),amount_money:order.total_money,order_id:order.id,location_id:location.id,autocomplete:true})).payment;
 if(payment.status!=="COMPLETED")throw Error("Payment not complete for "+people[i]);
 const token=(await pl("/sandbox/public_token/create",{institution_id:"ins_109508",initial_products:["transactions"]})).public_token;
 const access=(await pl("/item/public_token/exchange",{public_token:token})).access_token;
 const amount=payment.amount_money.amount/100;
 await pl("/sandbox/transactions/create",{access_token:access,transactions:[{amount,date_transacted:today,date_posted:today,description:"NORTH & CO",iso_currency_code:"GBP"}]});
 const transactions=(await pl("/transactions/get",{access_token:access,start_date:today,end_date:today})).transactions||[];
 const tx=transactions.find(t=>/NORTH/i.test(t.name)&&Math.round(t.amount*100)===payment.amount_money.amount);
 if(!tx)throw Error("Plaid transaction not returned for "+people[i]);
 results.push({customer:people[i],square:{orderId:order.id,paymentId:payment.id,product:variation.name,variant:variation.variant,amountMinor:payment.amount_money.amount,locationId:payment.location_id,createdAt:payment.created_at,cardBrand:payment.card_details?.card?.card_brand||null,cardLast4:payment.card_details?.card?.last_4||null},plaid:{transactionId:tx.transaction_id,accountId:tx.account_id,name:tx.name,amountMinor:Math.round(tx.amount*100),date:tx.date,authorizedDate:tx.authorized_date||null,merchantName:tx.merchant_name||null,location:tx.location||null,paymentMeta:tx.payment_meta||null}});
}
const decisions=results.map(r=>{const possible=results.filter(x=>x.plaid.amountMinor===r.square.amountMinor&&/NORTH/i.test(x.plaid.name)&&x.plaid.date===r.square.createdAt.slice(0,10));return {squareOrderId:r.square.orderId,expectedCustomer:r.customer,candidateCustomers:possible.map(x=>x.customer),registeredLast4Check:"NOT_PERFORMED_NO_AUTHENTICATED_REGISTRATION",plaidCardLast4Available:false,status:"UNVERIFIED",ownershipVerified:false,reason:"Plaid Sandbox injections are independent of Square payments; no shared card or transaction reference"};});
const report={run,source:"Actual Square Sandbox payments and actual Plaid Sandbox API transactions; separately created",results,decisions,verifiedWalletPurchases:0,falseAssignments:0};
console.log(JSON.stringify(report,null,2));
if(env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID){const d=await call("https://api.cloudflare.com/client/v4/accounts/"+env.CLOUDFLARE_ACCOUNT_ID+"/d1/database/6d3a035f-b869-4e1f-af61-bb34f2f5c51c/query",{Authorization:"Bearer "+env.CLOUDFLARE_API_TOKEN,"Content-Type":"application/json"},{sql:"INSERT INTO audit_events(id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)",params:[crypto.randomUUID(),"system","github_actions","coordinated_square_plaid_test","simulation",run,JSON.stringify(report)]});if(d.success===false)throw Error("D1 audit write failed");}
