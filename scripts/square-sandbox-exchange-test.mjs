// A manual Square SANDBOX-only settlement proof; no live payments or customer data.
// This intentionally does not touch the consumer wallet or live retailer inventory.
import { randomUUID } from "node:crypto";
const token=process.env.SQUARE_ACCESS_TOKEN;
if(!token)throw Error("Missing SQUARE_ACCESS_TOKEN secret. Sandbox credential required.");
const base="https://connect.squareupsandbox.com";
const headers={Authorization:"Bearer "+token,"Square-Version":"2026-09-16","Content-Type":"application/json"};
async function api(path,{method="GET",body}={}){
 const r=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();
 if(!r.ok||data.errors?.length)throw Error(path+" "+JSON.stringify(data.errors||data).slice(0,700));
 return data;
}
const location=(await api("/v2/locations")).locations?.find(x=>x.status==="ACTIVE"&&x.currency==="GBP");
if(!location)throw Error("Active GBP Square Sandbox location required.");
const money=amount=>({amount,currency:"GBP"});
async function createOrder(amount,label,ref,extra={}){
 const res=await api("/v2/orders",{method:"POST",body:{
   idempotency_key:randomUUID(),
   order:{location_id:location.id,reference_id:ref,line_items:[{name:label,quantity:"1",base_price_money:money(amount)}],...extra}
 }});
 return res.order;
}
async function pay(amount,orderId){
 const body={source_id:"cnon:card-nonce-ok",idempotency_key:randomUUID(),amount_money:money(amount),location_id:location.id,autocomplete:true};
 if(orderId)body.order_id=orderId;
 const result=(await api("/v2/payments",{method:"POST",body})).payment;
 if(result?.status!=="COMPLETED"||result.amount_money?.amount!==amount)throw Error("Payment not completed as requested.");
 return result;
}
const cases=[
 {name:"same-price",original:12999,replacement:12999},
 {name:"more-expensive",original:12999,replacement:13999},
 {name:"less-expensive",original:12999,replacement:11999}
],run=randomUUID().slice(0,8),report=[];
function check(cond,msg){if(!cond)throw Error("LINK CHECK FAILED: "+msg)}
for(const c of cases){
 const original=await createOrder(c.original,"Relay Sandbox ORIGINAL — "+c.name,"rl-orig-"+run+"-"+c.name);
 check(original.total_money?.amount===c.original,"original total");
 const originalPayment=await pay(c.original,original.id);
 // The replacement order carries an explicit "exchange credit" for the value of the
 // original purchase (capped at the replacement price) and records which order and
 // payment it replaces. Only the remaining balance is ever charged.
 const credit=Math.min(c.original,c.replacement),difference=c.replacement-c.original,due=Math.max(difference,0);
 const replacement=await createOrder(c.replacement,"Relay Sandbox REPLACEMENT — "+c.name,"rl-repl-"+run+"-"+c.name,{
   discounts:[{uid:"relay-exchange-credit",name:"Relay exchange credit",type:"FIXED_AMOUNT",amount_money:money(credit),scope:"ORDER"}],
   metadata:{relay_exchange_of:original.id,relay_original_payment:originalPayment.id,relay_run:run}
 });
 check(replacement.total_money?.amount===due,"replacement balance should be "+due+" but was "+replacement.total_money?.amount);
 let adjustment={type:"NONE",amountMinor:0,status:"NO_PAYMENT_REQUIRED",id:null};
 if(due>0){
   const extra=await pay(due,replacement.id); // payment is attached to the replacement order itself
   check(extra.order_id===replacement.id,"extra payment not attached to replacement order");
   adjustment={type:"ADDITIONAL_CARD_PAYMENT",amountMinor:due,status:extra.status,id:extra.id};
 }else{
   // Nothing left to pay: close the replacement order with no payment.
   await api("/v2/orders/"+replacement.id+"/pay",{method:"POST",body:{idempotency_key:randomUUID(),payment_ids:[]}});
   if(difference<0){
     const refund=(await api("/v2/refunds",{method:"POST",body:{
       idempotency_key:randomUUID(),payment_id:originalPayment.id,
       amount_money:money(-difference),reason:"Relay Sandbox exchange price difference"
     }})).refund;
     check(refund&&refund.amount_money?.amount===-difference&&["COMPLETED","PENDING"].includes(refund.status),"refund not accepted");
     check(refund.order_id===original.id,"refund not attached to the original order");
     adjustment={type:"PRICE_DIFFERENCE_REFUND",amountMinor:-difference,status:refund.status,id:refund.id};
   }
 }
 // Record the link on the original order too (needs its latest version).
 const freshOriginal=(await api("/v2/orders/"+original.id)).order;
 await api("/v2/orders/"+original.id,{method:"PUT",body:{idempotency_key:randomUUID(),order:{location_id:location.id,version:freshOriginal.version,metadata:{relay_replaced_by:replacement.id,relay_run:run}}}});
 // Read both orders back from Square and verify the link, rather than trusting what we sent.
 const o=(await api("/v2/orders/"+original.id)).order,r=(await api("/v2/orders/"+replacement.id)).order;
 check(o.metadata?.relay_replaced_by===replacement.id,"original order does not point to replacement");
 check(r.metadata?.relay_exchange_of===original.id,"replacement does not point to original order");
 check(r.metadata?.relay_original_payment===originalPayment.id,"replacement does not record original payment");
 check(r.state==="COMPLETED","replacement order state is "+r.state);
 const paid=(r.tenders||[]).reduce((n,t)=>n+(t.amount_money?.amount||0),0);
 check(paid===due,"replacement tenders total "+paid+" expected "+due);
 report.push({scenario:c.name,locationId:location.id,originalOrderId:original.id,originalPaymentId:originalPayment.id,replacementOrderId:replacement.id,originalMinor:c.original,replacementMinor:c.replacement,exchangeCreditMinor:credit,differenceMinor:difference,replacementBalanceMinor:due,adjustment,linkVerifiedFromSquare:true,replacementState:r.state,returnRequest:"SIMULATED_ONLY",productionReady:false});
}
console.log(JSON.stringify({sandboxOnly:true,testRun:run,liveFundsMoved:false,scenarios:report},null,2));
