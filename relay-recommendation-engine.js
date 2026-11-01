/* Relay Discover: explainable, opt-in purchase-history ranking.
 * Client-side only. No API calls, customer profiles or claims of machine-learning inference. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.RelayRecommendationEngine=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const normal=s=>String(s??"").toLowerCase().trim();
 const colours=["white","black","grey","gray","cream","sand","slate","forest","green","blue","navy","olive","pink","ecru","brown","stone","chalk","oat","washed","rust","charcoal","moss","clay","red","beige","camel","khaki","taupe","ivory","burgundy","lilac","lavender","purple","yellow","orange","mauve","teal","mint","sage"];
 const NEUTRAL=new Set(["white","black","grey","gray","cream","sand","slate","navy","ecru","brown","stone","chalk","oat","charcoal","beige","camel","khaki","taupe","ivory"]);
 // Style words found in item names. Each one is a plain description of what was bought, not a judgement of the person.
 const STYLES=[
  ["sporty","Sporty",/legging|\balign\b|jogger|\bgym\b|running|\brun\b|training|sports? bra|\btank\b|yoga|\bactive|performance|tracksuit|track (top|pant)|define jacket|scuba|seamless|trainer|sneaker/],
  ["relaxed","Relaxed",/oversized|relaxed|hoodie|sweatshirt|jogger|lounge|wide[- ]leg|flared?\b|baggy|slouch|cos[yi]|fleece/],
  ["smart","Smart",/blazer|tailored|\bsuit\b|chino|oxford|\bshirt\b|trouser|loafer|derby|brogue|pleat|wool coat|trench|knit polo/],
  ["outdoorsy","Outdoorsy",/waterproof|\brain\b|\bshell\b|parka|hiking|\btrail\b|gore-?tex|insulated|puffer|walking boot|windbreaker/],
  ["streetwear","Streetwear",/jordan|\bdunk\b|air max|cargo|graphic|retro high|high[- ]top|bomber|varsity|bucket hat/],
  ["cosy","Home comforts",/duvet|pillow|bedding|candle|\bthrow\b|cushion|mattress|\bbed\b|sofa|blanket|dressing gown|robe|slipper|headboard|divan/],
  ["techy","Tech",/headphone|earbud|airpods|charger|\bcase\b|cable|speaker|keyboard|smart ?watch|ipad|iphone|macbook|laptop/],
  ["selfcare","Self-care",/serum|moistur|cleanser|skincare|perfume|fragrance|\bspf\b|body wash|bath oil|face mask/]];
 function stylesOf(name){const s=normal(name);return STYLES.filter(x=>x[2].test(s)).map(x=>x[0]);}
 const styleLabel=k=>(STYLES.find(x=>x[0]===k)||[k,k])[1];
 // A size written on the receipt. Letters are only read in capitals ("M", not the "m" in a word).
 function sizeOf(variation,name){
  const raw=String(variation??""),all=raw+" "+String(name??"");
  const uk=/\bUK\s?(\d{1,2}(?:\.5)?)\b/i.exec(raw);
  if(uk&&category(name)==="footwear")return{kind:"footwear",value:"UK "+uk[1]};
  const letter=/(?:^|[\s\/(,-])(XXS|XS|S|M|L|XL|XXL|2XL|3XL)(?=$|[\s\/),-])/.exec(raw);
  if(letter)return{kind:"clothing",value:letter[1]};
  const piece=raw.split(/[\/,|·]/).map(x=>x.trim()).find(x=>/^\d{1,2}$/.test(x));
  const num=/\b(?:size|uk)\s*:?\s*(\d{1,2})\b/i.exec(raw)||(piece?[piece,piece]:null);
  if(num&&Number(num[1])>=2&&Number(num[1])<=30)return{kind:"clothing",value:(uk?"UK ":"")+num[1]};
  const waist=/\bW\s?(2\d|3\d|4\d)\b/.exec(raw);
  if(waist)return{kind:"waist",value:"W"+waist[1]};
  const bed=/\b(super ?king|king|small double|double|single)(?: size)?\b/i.exec(all);
  if(bed&&/bed|mattress|duvet|sheet|divan|headboard|frame/i.test(all))return{kind:"bed",value:bed[1].replace(/^./,c=>c.toUpperCase())};
  return null;
 }
 function category(name){
  const s=normal(name);
  if(/trainer|sneaker|shoe|boot|jordan/.test(s))return "footwear";
  if(/coat|jacket|trench|parka|puffer|rain shell/.test(s))return "outerwear";
  if(/shirt|tee|top|overshirt|jumper|sweater|hoodie|sweatshirt/.test(s))return "tops";
  if(/bag|tote|holdall|backpack|crossbody/.test(s))return "bags";
  if(/jean|trouser|legging|pant/.test(s))return "bottoms";
  if(/dress|skirt/.test(s))return "dresses";
  if(/\bbed\b|mattress|sofa|duvet|pillow|lamp|\brug\b|cushion|\bthrow\b|towel|candle|headboard|divan/.test(s))return "home";
  if(/headphone|earbud|airpods|charger|cable|speaker|laptop|tablet|ipad|iphone|keyboard|monitor|camera/.test(s))return "tech";
  return "other";
 }
 function colourOf(variation){
  const s=normal(variation);
  return colours.find(c=>new RegExp("\\b"+c+"\\b").test(s))||null;
 }
 function getHistory(purchases){
  const valid=(Array.isArray(purchases)?purchases:[]).filter(p=>p&&p.item&&p.merchant&&(p.demo===true||p.verified===true));
  return valid.map(p=>({category:category(p.item),colour:colourOf(p.detail)||colourOf(p.item),merchant:normal(p.merchant),shop:String(p.merchant).trim(),priceMinor:Math.round(Number(p.price||0)*100),
   size:sizeOf(p.detail,p.item),styles:stylesOf(p.item)}));
 }
 // The size worn most often for each kind of thing ("M" for clothes, "UK 9" for shoes).
 function usualSizes(history){
  const by={};
  history.forEach(h=>{if(!h.size)return;const m=by[h.size.kind]||(by[h.size.kind]=new Map());m.set(h.size.value,(m.get(h.size.value)||0)+1)});
  const out={};Object.keys(by).forEach(k=>{const best=[...by[k].entries()].sort((a,b)=>b[1]-a[1])[0];out[k]={value:best[0],count:best[1]}});
  return out;
 }
 function decorate(product,history,options={}){
  const c=category(product.product),colour=colourOf(product.variation);
  const sameCategory=c==='other'?[]:history.filter(p=>p.category===c);
  const sameColour=colour?sameCategory.filter(p=>p.colour===colour):[];
  const stores=new Set(sameCategory.map(p=>p.merchant));
  let score=0,explanation="";
  if(sameCategory.length){score+=Math.min(sameCategory.length,4)*12;explanation="Similar to your previous "+c+" purchases";}
  const myStyles=new Map();history.forEach(h=>(h.styles||[]).forEach(t=>myStyles.set(t,(myStyles.get(t)||0)+1)));
  const shared=stylesOf(product.product).filter(t=>myStyles.has(t)).sort((a,b)=>myStyles.get(b)-myStyles.get(a));
  if(shared.length){score+=Math.min(myStyles.get(shared[0]),3)*5;explanation="Matches your "+styleLabel(shared[0]).toLowerCase()+" style";}
  if(sameColour.length){score+=Math.min(sameColour.length,3)*7;explanation="A colour you've bought before in "+c;}
  const ps=sizeOf(product.variation,product.product),mine=ps&&usualSizes(history)[ps.kind];
  if(mine&&mine.value===ps.value){score+=10;explanation="In your usual size ("+ps.value+")";}
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
  const styleCount=new Map();buys.forEach(b=>(b.styles||[]).forEach(t=>styleCount.set(t,(styleCount.get(t)||0)+1)));
  const styles=[...styleCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,n])=>({key:k,name:styleLabel(k),count:n}));
  const coloured=buys.filter(b=>b.colour),neutral=coloured.filter(b=>NEUTRAL.has(b.colour)).length;
  const palette=coloured.length>=3?(neutral/coloured.length>=0.7?"neutrals":neutral/coloured.length<=0.3?"colour":"mix"):null;
  const shopNames=new Map();buys.forEach(b=>{if(b.shop)shopNames.set(b.merchant,b.shop)});
  const out={bought:buys.length,looked:looks.length,categories:top(all,"category",3),colours:top(all,"colour",3),
   shops:top(buys,"merchant",3).map(x=>({name:shopNames.get(x.name)||x.name,count:x.count})),
   typicalPriceMinor:prices.length?prices[Math.floor(prices.length/2)]:null,sizes:usualSizes(buys),styles,palette};
  out.headline=headline(out);
  return out;
 }
 // One friendly sentence from the counts. Every part is something on the receipts; parts with no evidence are left out.
 const ADJ={sporty:"sporty",relaxed:"relaxed",smart:"smart",outdoorsy:"outdoorsy",streetwear:"streetwear",cosy:"cosy at home",techy:"into your tech",selfcare:"into self-care"};
 function headline(p){
  if(!p.bought)return null;
  const bits=[];
  const st=p.styles.filter(x=>x.count>=1).slice(0,2).map(x=>ADJ[x.key]);
  if(st.length)bits.push("You're "+st.join(" and ")+(p.palette==="neutrals"?", mostly in neutrals":p.palette==="colour"?", and you love a bit of colour":p.colours[0]?", often in "+p.colours[0].name:"")+".");
  else if(p.colours[0]&&p.colours[0].count>=2)bits.push("You keep coming back to "+p.colours[0].name+".");
  const sz=p.sizes.clothing||p.sizes.footwear;
  const sizeBits=[p.sizes.clothing&&("a size "+p.sizes.clothing.value),p.sizes.footwear&&(p.sizes.footwear.value+" in shoes"),p.sizes.waist&&(p.sizes.waist.value+" in jeans")].filter(Boolean);
  if(sizeBits.length)bits.push("Usually "+sizeBits.join(", ")+".");
  if(p.sizes.bed)bits.push("You sleep "+p.sizes.bed.value.toLowerCase()+" size.");
  if(p.typicalPriceMinor)bits.push("A typical buy is about £"+Math.round(p.typicalPriceMinor/100)+".");
  return bits.length?bits.join(" "):null;
 }
 return Object.freeze({rank,category,colourOf,getHistory,tapOf,profile,sizeOf,stylesOf,headline});
});
