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
  const sameCategory=c==='other'?[]:history.filter(p=>p.category===c);
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
  const looked=c==='other'?[]:(options.interest||[]).filter(t=>t.category===c);
  if(looked.length){score+=Math.min(looked.length,4)*3;if(colour&&looked.some(t=>t.colour===colour))score+=3;explanation=explanation||"Similar to things you've looked at";}
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
 // What a shopper looked at (opened or watched). A tap is a weaker signal than a purchase, so it only nudges the order.
 function tapOf(product){return {category:category(product.product||product.item),colour:colourOf(product.variation||product.detail),merchant:normal(product.store||product.merchant||product.storeName),priceMinor:Math.round(Number(product.priceMinor||0))};}
 function top(list,key,n){const m=new Map();list.forEach(x=>{const k=x[key];if(k&&k!=="other")m.set(k,(m.get(k)||0)+1)});return [...m.entries()].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)).slice(0,n).map(([name,count])=>({name,count}));}
 // A plain summary of what Relay has noticed, shown to the shopper so nothing is hidden. Counts only: no guesses.
 function profile(purchases,taps){
  const buys=getHistory(purchases),looks=(Array.isArray(taps)?taps:[]).filter(t=>t&&t.category);
  const all=buys.concat(looks),prices=buys.map(b=>b.priceMinor).filter(n=>n>0).sort((a,b)=>a-b);
  return {bought:buys.length,looked:looks.length,categories:top(all,"category",3),colours:top(all,"colour",3),shops:top(buys,"merchant",3),
   typicalPriceMinor:prices.length?prices[Math.floor(prices.length/2)]:null};
 }
 return Object.freeze({rank,category,colourOf,getHistory,tapOf,profile});
});
