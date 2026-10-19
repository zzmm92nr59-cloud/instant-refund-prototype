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
async function createOrder(amount,label,ref){
 const res=await api("/v2/orders",{method:"POST",body:{
   idempotency_key:randomUUID(),
   order:{location_id:location.id,reference_id:ref,line_items:[{name:label,quantity:"1",base_price_money:money(amount)}]}
 }});
 if(res.order?.total_money?.amount!==amount)throw Error("Order total changed unexpectedly "+label);
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
for(const c of cases){
 // The original payment is independently created on Square Sandbox first.
 const original=await createOrder(c.original,"Relay Sandbox ORIGINAL — "+c.name,"rl-orig-"+run+"-"+c.name);
 const originalPayment=await pay(c.original,original.id);
 // Replacement is an actual Square Sandbox order, but it is NOT paid in full.
 // Its balance is not automatically settled by the original payment; production
 // needs retailer settlement/accounting integration and return authorisation.
 const replacement=await createOrder(c.replacement,"Relay Sandbox REPLACEMENT — "+c.name,"rl-repl-"+run+"-"+c.name);
 const difference=c.replacement-c.original;
 let adjustment={type:"NONE",amountMinor:0,status:"NO_PAYMENT_REQUIRED",id:null};
 if(difference>0){
   const extra=await pay(difference,null); // Test additional charge as standalone Sandbox payment.
   adjustment={type:"ADDITIONAL_CARD_PAYMENT",amountMinor:difference,status:extra.status,id:extra.id};
 }else if(difference<0){
   const refund=(await api("/v2/refunds",{method:"POST",body:{
     idempotency_key:randomUUID(),payment_id:originalPayment.id,
     amount_money:money(-difference),reason:"Relay Sandbox exchange price difference"
   }})).refund;
   if(!refund||refund.amount_money?.amount!==-difference||!["COMPLETED","PENDING"].includes(refund.status))throw Error("Refund request was not accepted.");
   adjustment={type:"PRICE_DIFFERENCE_REFUND",amountMinor:-difference,status:refund.status,id:refund.id};
 }
 report.push({scenario:c.name,locationId:location.id,originalOrderId:original.id,originalPaymentId:originalPayment.id,replacementOrderId:replacement.id,originalMinor:c.original,replacementMinor:c.replacement,differenceMinor:difference,adjustment,returnRequest:"SIMULATED_ONLY",replacementBalance:"NOT_LINKED_TO_ORIGINAL_PAYMENT",productionReady:false});
}
console.log(JSON.stringify({sandboxOnly:true,testRun:run,liveFundsMoved:false,scenarios:report},null,2));
console.log("Square Sandbox completed: 3 original payments, 3 replacement orders, 1 extra-charge payment, 1 partial refund request. No real return was submitted.");
