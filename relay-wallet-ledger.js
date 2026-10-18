/* Pure, browser/Node compatible demo-wallet projection.
   It does not settle payments or authorise retailer exchanges. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.RelayWalletLedger=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 function project({purchases=[],events=[],customer}={}){
  const visible=Array.isArray(purchases)?purchases.filter(p=>p&&p.id):[];
  const records=Array.isArray(events)?events.filter(r=>r&&r.type==="EXCHANGE"&&r.exchange===true&&r.customer===customer):[];
  const eventByOriginal=new Map();
  for(const record of records){
    if(record.originalPurchaseId&&!eventByOriginal.has(record.originalPurchaseId))eventByOriginal.set(record.originalPurchaseId,record);
  }
  const output=[];
  for(const p of visible){
    const record=p.demo===true?eventByOriginal.get(p.id):null;
    if(!record){output.push(p);continue;}
    const replacementId="replacement-"+record.id;
    const held=record.replacementStatus==="PENDING_RETURN_RECEIPT";
    output.push({
      id:replacementId,orderId:record.replacementOrderId||record.replacementRequestId,
      merchant:record.store,item:record.product,detail:record.variant,
      price:Number(record.amountMinor)/100,date:record.createdAt?new Date(record.createdAt).toLocaleDateString("en-GB"):String(record.date||""),
      createdAt:record.createdAt||record.date||"",deadline:"Retailer policy",
      demo:true,source:"demo_exchange",customer:record.customer,sku:record.sku,
      status:held?"Replacement queued":"Replacement ordered",exchangeRequestId:record.id,
      linkedOriginalId:p.id,returnStatus:record.returnStatus||"RETURN_REQUESTED",
      replacementStatus:record.replacementStatus,exchangeReason:record.reason
    });
    output.push({...p,status:"Exchanged",exchangeRequestId:record.id,
      linkedReplacementId:replacementId,returnStatus:record.returnStatus||"RETURN_REQUESTED",
      replacementStatus:record.replacementStatus,exchangeReason:record.reason});
  }
  return output;
 }
 return {project};
});
