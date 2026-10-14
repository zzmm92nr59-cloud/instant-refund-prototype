/* Relay Discover: explainable, opt-in purchase-history ranking.
 * Client-side only. No API calls, customer profiles or claims of machine-learning inference. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.RelayRecommendationEngine=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const normal=s=>String(s??"").toLowerCase().trim();
 const colours=["white","black","grey","gray","cream","sand","slate","forest","green","blue","navy","olive","pink","ecru","brown","stone","chalk","oat","washed","rust","charcoal","moss","clay","red"];
 function category(name){
  const s=normal(name);
  if(/trainer|sneaker|shoe|boot|jordan/.test(s))return "footwear";
  if(/coat|jacket|trench|parka|puffer|rain shell/.test(s))return "outerwear";
  if(/shirt|tee|top|overshirt|jumper|sweater|hoodie|sweatshirt/.test(s))return "tops";
  if(/bag|tote|holdall|backpack|crossbody/.test(s))return "bags";
  if(/jean|trouser|legging|pant/.test(s))return "bottoms";
  if(/dress|skirt/.test(s))return "dresses";
  return "other";
 }
 function colourOf(variation){
  const s=normal(variation);
  return colours.find(c=>new RegExp("\\b"+c+"\\b").test(s))||null;
 }
 function getHistory(purchases){
  const valid=(Array.isArray(purchases)?purchases:[]).filter(p=>p&&p.item&&p.merchant&&(p.demo===true||p.verified===true));
  return valid.map(p=>({category:category(p.item),colour:colourOf(p.detail),merchant:normal(p.merchant),priceMinor:Math.round(Number(p.price||0)*100)}));
 }
 function decorate(product,history,options={}){
  const c=category(product.product),colour=colourOf(product.variation);
  const sameCategory=history.filter(p=>p.category===c);
  const sameColour=colour?sameCategory.filter(p=>p.colour===colour):[];
  const stores=new Set(sameCategory.map(p=>p.merchant));
  let score=0,explanation="";
  if(sameCategory.length){score+=Math.min(sameCategory.length,4)*12;explanation="Similar to your previous "+c+" purchases";}
  if(sameColour.length){score+=Math.min(sameColour.length,3)*7;explanation="A colour you've bought before in "+c;}
  if(stores.size>1){score+=9;explanation=explanation||"Inspired by purchases across your shops";}
  if(sameCategory.length&&Number.isFinite(Number(product.priceMinor))){
    const avg=sameCategory.reduce((sum,p)=>sum+p.priceMinor,0)/sameCategory.length;
    if(avg>0){const ratio=Math.abs(Number(product.priceMinor)-avg)/avg;score+=Math.max(0,8-Math.round(ratio*12))}
  }
  if(product.fixture===true&&Number(product.quantity)>0)score+=4;
  if(options.original){
   const original=options.original;
   if(c===category(original.item))score+=18;
   if(normal(product.product)!==normal(original.item)&&(options.reason==="design"||options.reason==="mind"))score+=14;
   if(Number(product.priceMinor)<=Math.round(Number(original.price)*100))score+=3;
   if(!explanation)explanation="Alternative in the same category as your purchase";
  }
  return {...product,_relayRecScore:score,_relayReason:explanation||"An alternative from the connected catalogue"};
 }
 function rank(products,purchases,options={}){
  const history=getHistory(purchases);
  const prepared=(Array.isArray(products)?products:[]).map((product,index)=>({...decorate(product,history,options),_relayOriginalIndex:index}));
  prepared.sort((a,b)=>b._relayRecScore-a._relayRecScore||a._relayOriginalIndex-b._relayOriginalIndex);
  return prepared;
 }
 return Object.freeze({rank,category,colourOf,getHistory});
});
