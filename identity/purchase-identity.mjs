/**
 * Relay purchase identity v0.1 — pure, provider-independent matching core.
 * No network calls, no card PAN, no user authentication.
 * IMPORTANT: a score is NOT proof of ownership or authorisation to issue funds.
 */
export const IDENTIFIER_REGISTRY = Object.freeze({
  bank: ["bank_transaction_id","account_connection_id","merchant_name","merchant_id","amount_minor","currency","booking_date","value_date","pending","payment_reference","card_brand","card_last4"],
  order: ["retailer_id","retailer_order_id","processor","processor_order_id","processor_payment_id","payment_reference","amount_minor","currency","ordered_at","customer_verified_id","card_brand","card_last4","line_items","return_deadline"],
  linking: ["verified_retailer_account_id","verified_customer_account_id","verified_email_challenge","merchant_oauth_tenant_id","shared_processor_reference"]
});
const norm = v => String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
const same = (a,b) => Boolean(norm(a) && norm(b) && norm(a)===norm(b));
const withinDays = (a,b,days) => {
  const x=Date.parse(a),y=Date.parse(b);
  return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=days*86400000;
};
export function assessCandidate(bank,order,{maxDays=7}={}){
  const evidence=[],conflicts=[];
  if(!bank||!order)return {status:"unmatched",score:0,evidence,conflicts:["missing_record"]};
  if(bank.currency && order.currency && !same(bank.currency,order.currency))conflicts.push("currency_conflict");
  if(Number.isInteger(bank.amount_minor)&&Number.isInteger(order.amount_minor)&&bank.amount_minor!==order.amount_minor)conflicts.push("amount_conflict");
  if(bank.card_last4 && order.card_last4 && !same(bank.card_last4,order.card_last4))conflicts.push("card_last4_conflict");
  if(bank.card_brand && order.card_brand && !same(bank.card_brand,order.card_brand))conflicts.push("card_brand_conflict");
  if(conflicts.length)return {status:"conflict",score:0,evidence,conflicts};
  let score=0;
  const add=(condition,key,points)=>{if(condition){evidence.push(key);score+=points}};
  add(same(bank.shared_processor_reference,order.shared_processor_reference),"shared_processor_reference",90);
  add(same(bank.payment_reference,order.payment_reference),"payment_reference",40);
  add(same(bank.merchant_id,order.merchant_id),"merchant_id",20);
  add(same(bank.merchant_name,order.merchant_name),"merchant_name",10);
  add(Number.isInteger(bank.amount_minor)&&bank.amount_minor===order.amount_minor,"amount",20);
  add(same(bank.currency,order.currency),"currency",5);
  add(withinDays(bank.booking_date,order.ordered_at,maxDays),"date_window",10);
  add(same(bank.card_last4,order.card_last4),"card_last4",10);
  add(same(bank.card_brand,order.card_brand),"card_brand",5);
  const hasSharedRef=evidence.includes("shared_processor_reference");
  // Candidate scoring never establishes customer ownership, even at 100.
  return {status:hasSharedRef?"strong_candidate":score>=45?"potential":"unmatched",score,evidence,conflicts,requiresOwnershipVerification:true};
}
export function discoverCandidates(bankTransactions,retailerOrders,{lookbackDays=60,now=new Date()}={}){
  const cutoff=now.getTime()-lookbackDays*86400000;
  return bankTransactions.filter(b=>Date.parse(b.booking_date)>=cutoff).flatMap(b=>
    retailerOrders.map(o=>({bank_transaction_id:b.bank_transaction_id,retailer_order_id:o.retailer_order_id,...assessCandidate(b,o)}))
      .filter(x=>x.status!=="unmatched")
  ).sort((a,b)=>b.score-a.score);
}
export function claimRequirements(candidate){
  if(candidate?.status==="conflict"||candidate?.status==="unmatched")return {eligible:false,reason:"insufficient_or_conflicting_evidence"};
  return {eligible:false,reason:"requires_authenticated_customer_and_authorised_retailer_order_lookup"};
}
