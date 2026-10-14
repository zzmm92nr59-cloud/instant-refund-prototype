/* Relay exchange orchestration — browser-only demo. No Square payment/return calls. */
(function(root,factory){
  const engine=factory();
  if(typeof module==="object"&&module.exports)module.exports=engine;
  else root.RelayExchangeEngine=engine;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const minor=n=>Math.round(Number(n)*100);
 const normal=s=>String(s??"").trim().toLowerCase().replace(/\s+/g," ");
 function sizeOf(s){
   s=normal(s);
   const uk=s.match(/\buk\s*(\d{1,2}(?:\.5)?)\b/);
   if(uk)return "uk "+uk[1];
   const match=s.match(/\b(xxs|xs|xxxl|xxl|xl|small|medium|large|s|m|l)\b/);
   return match?({s:"small",m:"medium",l:"large"}[match[1]]||match[1]):null;
 }
 function styleOf(s){return normal(s).replace(/\buk\s*\d{1,2}(?:\.5)?\b/g,"").replace(/\b(xxs|xs|xxxl|xxl|xl|small|medium|large|s|m|l)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().split(" ").filter(Boolean).sort().join(" ")}
 function category(name){
   const s=normal(name);
   if(/bag|tote|handbag|backpack|purse|satchel/.test(s))return "bag";
   if(/coat|jacket|parka|trench|puffer|rain shell/.test(s))return "outerwear";
   if(/trainer|shoe|sneaker|jordan|footwear|boot/.test(s))return "footwear";
   if(/hoodie|sweatshirt|jumper|sweater|shirt|blouse|tee|t-shirt|top|overshirt/.test(s))return "tops";
   if(/jean|trouser|pant|legging/.test(s))return "bottoms";
   if(/dress|skirt/.test(s))return "dress";
   return "other";
 }
 function matches(purchase,candidate,reason){
   if(!purchase||!candidate)return false;
   if(normal(purchase.merchant)!==normal(candidate.store))return false;
   const family=normal(purchase.item)===normal(candidate.product);
   const originalStyle=styleOf(purchase.detail),nextStyle=styleOf(candidate.variation);
   const a=sizeOf(purchase.detail),b=sizeOf(candidate.variation);
   const exactSame=family&&normal(purchase.detail)===normal(candidate.variation);
   if(reason==="size")return family&&!!a&&!!b&&a!==b&&originalStyle===nextStyle;
   if(reason==="colour")return family&&originalStyle!==nextStyle&&(!a||!b||a===b);
   if(reason==="design")return !exactSame&&category(purchase.item)===category(candidate.product);
   if(reason==="mind")return !exactSame&&category(purchase.item)===category(candidate.product);
   return false;
 }
 function quote({purchase,candidate,reason,existing=[]}){
   if(!purchase||purchase.demo!==true)throw Error("Only fictional demo purchases are supported. A real purchase needs a verified retailer integration.");
   const cataloguePreview=!!candidate&&candidate.previewSimulation===true&&candidate.provider==="square_sandbox"&&candidate.fixture!==true&&/^DEMO-[A-Z0-9-]+$/i.test(String(candidate.sku||""));
   if(!candidate||(candidate.fixture!==true&&!cataloguePreview))throw Error("Only demo inventory or explicitly labelled Square Sandbox preview simulations are supported.");
   if(!matches(purchase,candidate,reason))throw Error("This variant does not qualify for the selected same-retailer exchange.");
   if(!cataloguePreview&&(!Number.isInteger(Number(candidate.quantity))||Number(candidate.quantity)<1))throw Error("Replacement out of stock.");
   if(existing.some(x=>x.originalPurchaseId===purchase.id&&x.exchange===true))throw Error("This demo purchase already has an exchange. Reset test transactions to try another.");
   if(existing.some(x=>x.originalPurchaseId===purchase.id&&(x.type==="REFUND"||(x.type==="RETURN"&&(x.returnStatus!=="RETURN_RECEIVED"||!!(x.ledger||[]).length)))))throw Error("A previous refund or an incomplete return prevents this exchange.");
   const orig=minor(purchase.price),next=Number(candidate.priceMinor);
   if(!Number.isSafeInteger(orig)||orig<0||!Number.isSafeInteger(next)||next<0)throw Error("Invalid currency amount.");
   const delta=next-orig;
   return {originalMinor:orig,replacementMinor:next,differenceMinor:delta,paymentMinor:Math.max(delta,0),refundMinor:Math.max(-delta,0),currency:"GBP",sku:candidate.sku,store:candidate.store,reason,stockConfirmed:!cataloguePreview,cataloguePreview};
 }
 function ledgerForQuote(q){if(q.paymentMinor>0)return[{type:"ADDITIONAL_CARD_PAYMENT",amountMinor:q.paymentMinor,currency:"GBP",status:"SIMULATED_CAPTURED"}];if(q.refundMinor>0)return[{type:"PRICE_DIFFERENCE_REFUND",amountMinor:q.refundMinor,currency:"GBP",status:"SIMULATED_ISSUED"}];return [{type:"EVEN_EXCHANGE",amountMinor:0,currency:"GBP",status:"NO_PAYMENT_REQUIRED"}]}
 function createExchange({purchase,candidate,reason,existing=[],id,at,fulfilmentMode="advance"}){
   if(!id||!/^[a-zA-Z0-9-]{8,70}$/.test(id))throw Error("A unique request ID is required.");
   if(existing.some(x=>x.id===id))throw Error("Duplicate exchange request ID.");
   if(fulfilmentMode!=="advance"&&fulfilmentMode!=="hold")throw Error("Unknown exchange fulfilment mode.");
   const q=quote({purchase,candidate,reason,existing}),now=at||new Date().toISOString(),held=fulfilmentMode==="hold";
   const receivedReturn=existing.find(x=>x.originalPurchaseId===purchase.id&&x.type==="RETURN"&&x.returnStatus==="RETURN_RECEIVED");
   return {id,type:"EXCHANGE",exchange:true,originalPurchaseId:purchase.id,originalProduct:purchase.item,originalVariant:purchase.detail,originalPriceMinor:q.originalMinor,store:candidate.store,sku:candidate.sku,product:candidate.product,variant:candidate.variation,amount:q.replacementMinor/100,amountMinor:q.replacementMinor,difference:q.differenceMinor/100,differenceMinor:q.differenceMinor,reason,currency:"GBP",date:now,createdAt:now,stockConfirmed:q.stockConfirmed,cataloguePreview:q.cataloguePreview,fulfilmentMode,status:held?"EXCHANGE_REQUESTED_AWAITING_RETURN":"REPLACEMENT_ORDER_CREATED",replacementStatus:held?"PENDING_RETURN_RECEIPT":"ORDER_CREATED",replacementRequestId:id+"-REPLACEMENT",replacementOrderId:held?null:id+"-ORDER",returnRequestId:receivedReturn?receivedReturn.returnRequestId:id+"-RETURN",returnStatus:receivedReturn?"RETURN_RECEIVED":"RETURN_REQUESTED",ledger:ledgerForQuote(q).map(e=>held&&e.type!=="EVEN_EXCHANGE"?{...e,status:"SIMULATED_PENDING"}:e),history:[{event:"EXCHANGE_STARTED",at:now},{event:held?"REPLACEMENT_QUEUED_PENDING_RETURN":"REPLACEMENT_ORDER_CREATED",at:now},{event:receivedReturn?"EXISTING_RETURN_RECEIVED":"ORIGINAL_RETURN_REQUESTED",at:now}]};
 }
 function createInstantRefund({purchase,existing=[],id,at}){
   if(!purchase||purchase.demo!==true)throw Error("Only demo purchases support simulated instant refunds.");
   if(existing.some(x=>x.originalPurchaseId===purchase.id&&(x.exchange||x.type==="REFUND"||x.type==="RETURN")))throw Error("A refund, return or exchange has already been recorded for this purchase.");
   if(!id||!/^[a-zA-Z0-9-]{8,70}$/.test(id)||existing.some(x=>x.id===id))throw Error("Unique refund request ID required.");
   const amount=minor(purchase.price);if(!Number.isSafeInteger(amount)||amount<0)throw Error("Invalid refund amount.");
   const now=at||new Date().toISOString();
   return {id,type:"REFUND",exchange:false,originalPurchaseId:purchase.id,originalProduct:purchase.item,originalVariant:purchase.detail,originalPriceMinor:amount,amount:amount/100,amountMinor:amount,currency:"GBP",store:purchase.merchant,date:now,createdAt:now,status:"SIMULATED_INSTANT_ADVANCE_ISSUED",returnRequestId:id+"-RETURN",returnStatus:"RETURN_REQUESTED",ledger:[{type:"INSTANT_REFUND_ADVANCE",amountMinor:amount,currency:"GBP",status:"SIMULATED_ISSUED"}],history:[{event:"INSTANT_ADVANCE_SIMULATED",at:now},{event:"ORIGINAL_RETURN_REQUESTED",at:now}]};
 }
 function createReturnOnly({purchase,existing=[],id,at}){
   if(!purchase||purchase.demo!==true)throw Error("Only fictional demo purchases support simulated return requests.");
   if(existing.some(x=>x.originalPurchaseId===purchase.id&&(x.exchange||x.type==="REFUND"||x.type==="RETURN")))throw Error("This demo purchase already has a refund, return or exchange.");
   if(!id||!/^[a-zA-Z0-9-]{8,70}$/.test(id)||existing.some(x=>x.id===id))throw Error("Unique return request ID required.");
   const amount=minor(purchase.price);if(!Number.isSafeInteger(amount)||amount<0)throw Error("Invalid return amount.");
   const now=at||new Date().toISOString();
   return {id,type:"RETURN",exchange:false,originalPurchaseId:purchase.id,originalProduct:purchase.item,originalVariant:purchase.detail,originalPriceMinor:amount,amount:amount/100,amountMinor:amount,currency:"GBP",store:purchase.merchant,date:now,createdAt:now,status:"RETURN_REQUESTED",returnRequestId:id+"-RETURN",returnStatus:"RETURN_REQUESTED",ledger:[],history:[{event:"ORIGINAL_RETURN_REQUESTED",at:now}]};
 }
 const returnStates=["RETURN_REQUESTED","RETURN_LABEL_ISSUED","RETURN_IN_TRANSIT","RETURN_RECEIVED","RETURN_COMPLETED"];
 function advanceReturn(record,at,options={}){
   if(!record||!returnStates.includes(record.returnStatus))throw Error("Invalid return request.");
   const idx=returnStates.indexOf(record.returnStatus);if(idx===returnStates.length-1)return record;
   const status=returnStates[idx+1],now=at||new Date().toISOString();
   const standardRefund=record.type==="RETURN"&&status==="RETURN_COMPLETED"&&!options.exchangeAlreadyIssued;
   const releaseReplacement=record.type==="EXCHANGE"&&record.replacementStatus==="PENDING_RETURN_RECEIPT"&&status==="RETURN_RECEIVED";
   const releaseLedger=releaseReplacement?(record.ledger||[]).map(e=>e.status==="SIMULATED_PENDING"?{...e,status:e.type==="ADDITIONAL_CARD_PAYMENT"?"SIMULATED_CAPTURED":"SIMULATED_ISSUED"}:e):record.ledger;
   const ledger=standardRefund?[...(record.ledger||[]),{type:"STANDARD_REFUND_AFTER_RETURN",amountMinor:record.originalPriceMinor,currency:record.currency,status:"SIMULATED_ISSUED"}]:releaseLedger;
   return {...record,returnStatus:status,
     status:standardRefund?"SIMULATED_STANDARD_REFUND_AFTER_RETURN":releaseReplacement?"REPLACEMENT_ORDER_CREATED":options.exchangeAlreadyIssued&&status==="RETURN_COMPLETED"?"RETURN_COMPLETED_WITH_EXCHANGE":record.status,
     replacementStatus:releaseReplacement?"ORDER_CREATED":record.replacementStatus,
     replacementOrderId:releaseReplacement?record.id+"-ORDER":record.replacementOrderId,
     ledger,history:[...(record.history||[]),{event:status,at:now},...(releaseReplacement?[{event:"SIMULATED_REPLACEMENT_ORDER_CREATED_AFTER_RETURN",at:now}]:[]),...(standardRefund?[{event:"STANDARD_REFUND_SIMULATED_AFTER_RETURN",at:now}]:[])]}
 }

 return {sizeOf,styleOf,category,matches,quote,createExchange,createInstantRefund,createReturnOnly,advanceReturn,returnStates};
});
