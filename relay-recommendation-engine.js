/* Relay Discover: explainable, opt-in purchase-history ranking.
 * Client-side only. No API calls, customer profiles or claims of machine-learning inference. */
(function(root,factory){
 // What a thing is comes from worker/item-kind-core.js, the same file the server uses (loaded before this one in the app).
 const core=root&&root.RelayItemKind?root.RelayItemKind:(typeof require==="function"&&typeof module==="object"?(()=>{try{return require("./worker/item-kind-core.js")}catch(e){return null}})():null);
 const api=factory(core);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.RelayRecommendationEngine=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(Core){
 "use strict";
 // Lower case, with the shops' fancy hyphens (T‑shirt) and quotes made plain.
 const normal=s=>String(s??"").toLowerCase().replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[\u2018\u2019]/g,"'").trim();
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
 // The broad kind of a thing, for ranking Browse. What the thing is comes from item-kind-core.js when it is sure (a Jordan
 // backpack is a bag, Boots' meal deal isn't footwear, a black bag is never "like" black trainers); the word lists below only
 // split clothes into tops, bottoms and so on, or decide for a name the core can't place.
 const CORE_CATEGORY={footwear:"footwear",accessories:null,home:"home",electronics:"tech"};
 function category(name){
  const s=normal(name);
  const c=Core?Core.classify(name):null;
  if(c&&c.confidence!=="low"){
   if(c.kind==="footwear")return "footwear";
   if(c.kind==="accessories")return /bag|tote|holdall|backpack|crossbody|rucksack|satchel|clutch|purse/.test(s)?"bags":"other";
   if(c.kind==="clothing"){
    if(/coat|jacket|trench|parka|puffer|rain shell|gilet|blazer/.test(s))return "outerwear";
    if(/shirt|tee|top|overshirt|jumper|sweater|hoodie|sweatshirt|cardigan|blouse|polo/.test(s))return "tops";
    if(/jean|trouser|legging|pant|chino|jogger|shorts/.test(s))return "bottoms";
    if(/dress|skirt/.test(s))return "dresses";
    return "other";
   }
   if(CORE_CATEGORY[c.kind])return CORE_CATEGORY[c.kind];
   return "other";
  }
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
 function tapOf(product){const name=product.product||product.item,k=kindOf(name);return {category:category(name),kind:k&&k.key?k.key:null,colour:colourOf(product.variation||product.detail),merchant:normal(product.store||product.merchant||product.storeName),priceMinor:Math.round(Number(product.priceMinor||0))};}
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
 // Picks from the things themselves, not from where the money went (Connor, 15 Nov 2026): a £200 TV is one purchase, not a
 // love of electronics. Each bought item is read for what it is:
 //  - a one-off or something no shop here should follow up (a TV, a laptop, a sofa, a subscription): nothing is picked;
 //  - something people buy again in other colours and cuts (leggings, a hoodie, trainers): more of the same kind;
 //  - something with a companion (coffee: a cup): one companion at most, because they probably own one already.
 // An item Relay can't place (most food, anything unusual) picks nothing. Nothing is guessed.
 const ONE_OFF=/\btv\b|television|\boled\b|\bqled\b|monitor|laptop|macbook|\bimac\b|console|playstation|xbox|nintendo|fridge|freezer|washing machine|tumble dryer|dishwasher|\boven\b|\bhob\b|microwave|vacuum|sofa|wardrobe|gift ?card|subscription|membership|\bplan\b|delivery|postage|warranty|insurance/;
 const KINDS=[
  // [key, what to call theirs, what they bought, what to pick (same when null)]. Order matters: the first that fits wins
  // (Boxer Shorts are underwear, a Knit Jacket is a jacket, a Tight Fit Tee is a T-shirt).
  ["pet","things for your pet",/\b(dogs?|cats?|pupp(y|ies)|kittens?|pets?)\b|\blitter\b/,null],
  ["underwear","underwear",/boxer|\bbriefs?\b|knicker|underwear|\bthong\b|\btrunks\b|g-string/,null],
  ["swimwear","swimwear",/bikini|swimsuit|swim ?shorts|swimming costume|swimwear/,null],
  ["footballshirt","football shirt",/\b(home|away|third) (shirt|jersey)\b|football (shirt|jersey)|\bkit\b(?=.*\b(fc|united|city)\b)/,/\b(home|away|third) (shirt|jersey)\b|football (shirt|jersey)/],
  ["tshirt","T-shirt",/\bt[- ]?shirts?\b|\btees?\b|\btanks?\b/,/\bt[- ]?shirts?\b|\btees?\b/],
  ["leggings","leggings",/legging|\btights?\b(?! fit)|\balign\b/,/legging|\btights?\b(?! fit)/],
  ["joggers","joggers",/jogger|sweatpant|track ?pant|tracksuit bottom|training pant/,null],
  ["shorts","shorts",/\bshorts\b/,null],
  ["jeans","jeans",/\bjeans?\b/,null],
  ["sportsbra","sports bra",/sports? bra|\bbra\b|bralette/,null],
  ["hoodie","hoodie",/hoodie|sweatshirt|\bscuba\b/,/hoodie|sweatshirt/],
  ["jacket","jacket",/jacket|\bcoat\b|raincoat|parka|puffer|gilet|anorak/,null],
  ["jumper","jumper",/jumper|sweater|cardigan|\bknit\b|roll neck/,null],
  ["shirt","shirt",/\bshirt\b|overshirt|blouse|\bpolo\b/,/(?<!\bt[- ]?)\bshirt\b|overshirt|blouse|\bpolo\b/],
  ["top","top",/\btops?\b|bodysuit|\bcami(sole)?\b/,/\btops?\b|bodysuit|\bcami(sole)?\b/],
  ["jumpsuit","jumpsuit",/jumpsuit|playsuit|dungaree|boiler ?suit/,null],
  ["dress","dress",/\bdress\b/,null],
  ["skirt","skirt",/\bskirt\b/,null],
  ["trousers","trousers",/trouser|chino|\bpants?\b|\bflares\b/,/trouser|chino|\bpants\b|\bflares\b/],
  ["pyjamas","pyjamas",/pyjama|pajama|\bpjs?\b|nightie|nightdress|loungewear set/,null],
  ["boots","boots",/\bboots?\b/,null],
  ["shoes","shoes",/loafer|sandal|court shoe|\bheels?\b|ballet flat|\bmules?\b|slipper|espadrille/,null],
  ["trainers","trainers",/trainer|sneaker|running shoe|\bshoes?\b/,null],
  ["socks","socks",/socks?\b/,null],
  ["bag","bag",/\bbag\b|\btote\b|backpack|rucksack|holdall|\bpouch\b/,/\bbag\b|\btote\b|backpack|rucksack|holdall/],
  ["hat","hat",/beanie|\bcap\b|\bhat\b/,null],
  ["scarf","scarf",/scarf|snood/,null],
  ["gloves","gloves",/gloves?\b|mittens?|wrist warmers?/,null],
  ["tie","tie",/\btie\b(?! front)/,/\btie\b(?! front| dye)/],
  ["mug","mugs",/\bmugs?\b|\bteacup|cup and saucer/,/\bmugs?\b|\bteacup|cup and saucer/],
  ["blanket","blanket",/blanket|\bthrow\b/,null],
  ["hairbrush","hairbrush",/hairbrush|hair brush|\bcomb\b/,null],
  ["cushion","cushion",/cushion/,null],
  ["candle","candle",/candle|diffuser/,null],
  ["skincare","skincare",/serum|moisturi[sz]|cleanser|\bspf\b|face (cream|oil|mask|wash)|hand cream|body (wash|lotion|oil)/,null]];
 const COMPANIONS=[
  // [key, what to call theirs, what they bought, what goes with it, what's an even better fit]
  ["coffee","coffee",/nespresso|espresso|coffee|\bcapsules?\b|\bpods?\b|lungo|ristretto/,/espresso cup|coffee cup|\bmugs?\b|\bcups?\b/,/espresso/],
  ["tea","tea",/tea ?bags?|teabags?|loose leaf|earl grey|english breakfast|green tea|herbal tea|\bchai\b|yorkshire tea|pg tips|twinings/,/\bmugs?\b|teapot|\bcups?\b/,/tea/],
  ["wine","wine",/\bwine\b|prosecco|champagne/,/wine glass|\bglasses\b|decanter|corkscrew/,/wine/],
  ["bed","bedding",/duvet|mattress|\bbed\b|\bdivan\b/,/pillowcase|duvet cover|fitted sheet|\bsheets?\b|bedding|\bthrow\b|blanket/,null]];
 // What a bought item is: {mode:"none"} for a one-off, "similar" or "companion" with its kind, or null when Relay can't say.
 // Lines on a receipt that aren't things anyone would want more of: a supermarket's carrier bag, bin bags, packaging.
 const NOT_A_THING=/washing bag|laundry bag|carrier bag|bags? for life|plastic bag|paper bag|reusable (shopping )?bag|shopping bag|bin bag|bin liner|freezer bag|sandwich bag|food bag|gift bag|gift wrap|packaging|\bbag charge\b/;
 // Trainer model and brand names only say "trainers" when nothing else in the name says what it is (Connor, 18 Nov 2026:
 // a Jordan backpack is a bag, not trainers); a pick for trainers must still be trainers by the same test.
 const TRAINER_MODELS=/\bair max\b|\bair force\b|\bjordan\b|\bdunks?\b|\bsamba\b|\bgazelle\b|ultraboost|\bnew balance \d{3,4}\b|\bstan smith\b|\bsuperstar\b|\bcortez\b|\bvomero\b|\bpegasus\b/;
 // Food, drink and things for skin and hair: never clothes or shoes, whatever a word in them looks like (heel balm isn't
 // heels, a Moscow Mule isn't mules, a chicken drumstick isn't a stick, a sharing bag of sweets isn't a bag). Connor, 18 Nov
 // 2026: "What shoes have I bought from Sainsbury's?" item-kind-core.js decides; this word list is only for a page that
 // hasn't loaded it.
 const FOOD_OR_CARE_WORDS=/\bbalm\b|\bcream\b|\blotion\b|\bgel\b|\bwash\b|shampoo|conditioner|plasters?|\bfile\b|\bgrips?\b|insoles?|\bpads?\b|moscow mule|\bmule (can|cocktail)|\bchicken\b|\bbeef\b|\bpork\b|\blamb\b|\bham\b|\bbacon\b|\bfish\b|\bsalmon\b|\bcheese\b|\bmilk\b|\bbread\b|\bbuns?\b|\bcake\b|biscuit|chocolate|\bcrisps?\b|\bsweets?\b|\bfruit\b|\bveg\b|\bsalad\b|\bpasta\b|\brice\b|\bsoup\b|\bsauce\b|\bpizza\b|\bsandwich|\bwrap\b|\bjuice\b|\bwater\b|\bcola\b|\bbeer\b|\bcider\b|\bgin\b|\bvodka\b|\bcoffee\b|\btea\b|\bcereal\b|\byoghurt|\byogurt|\beggs?\b|\bbutter\b|\bsausages?\b|\bpie\b|\bnoodles?\b|\bkg\b|\d+ ?(g|ml|l|cl)\b|\d+ ?x ?\d/;
 // What the core says a thing is: "used" (eaten, drunk, washed with), "pet", "beauty", "none" (travel, an app, a service, a
 // gift card: nothing to pick from), or null when it isn't sure (the word lists below then decide).
 function coreSays(name,shop){
  if(!Core)return FOOD_OR_CARE_WORDS.test(normal(name))?"used":null;
  const c=Core.classify(name,shop?{shop}:undefined);if(c.confidence==="low")return null;
  if(c.kind==="pets")return "pet";if(c.kind==="beauty_health")return "beauty";
  if(c.kind==="food_drink"||c.kind==="household")return "used";
  if(c.kind==="travel"||c.kind==="digital"||c.kind==="services"||c.kind==="gift_cards")return "none";
  return "thing";
 }
 // What each kind in KINDS is in item-kind-core.js's words: a pick named "boots" or "trainers" must be footwear, a bag must be
 // a bag, by what the thing is and never by a word or a colour it shares (Connor, 18 Nov 2026).
 const KIND_IS={underwear:"clothing",swimwear:"clothing",footballshirt:"clothing",tshirt:"clothing",leggings:"clothing",joggers:"clothing",
  shorts:"clothing",jeans:"clothing",sportsbra:"clothing",hoodie:"clothing",jacket:"clothing",jumper:"clothing",shirt:"clothing",top:"clothing",
  jumpsuit:"clothing",dress:"clothing",skirt:"clothing",trousers:"clothing",pyjamas:"clothing",socks:"clothing",boots:"footwear",shoes:"footwear",
  trainers:"footwear",bag:"accessories",hat:"accessories",scarf:"accessories",gloves:"accessories",tie:"accessories",mug:"home",blanket:"home",
  cushion:"home",candle:"home"};
 // The core's own kind for a name when it is sure of it, else null.
 function coreKind(name,shop){if(!Core)return null;const c=Core.classify(name,shop?{shop}:undefined);return c.confidence==="high"||c.confidence==="ai"?c.kind:null;}
 const fitsCore=(key,ck)=>!ck||!KIND_IS[key]||KIND_IS[key]===ck||(ck==="sport_outdoor"&&(KIND_IS[key]==="clothing"||KIND_IS[key]==="footwear"));
 function kindOf(name,shop){
  const s=normal(name);if(!s)return null;
  if(NOT_A_THING.test(s))return {mode:"none"};
  if(ONE_OFF.test(s))return {mode:"none"};
  if(/\btea ?bags?\b/.test(s)){const c=COMPANIONS.find(x=>x[0]==="tea");return {mode:"companion",key:c[0],noun:c[1],want:c[3],better:null};}
  const says=coreSays(name,shop);
  if(says==="none")return {mode:"none"};
  // Pets: more for the pet. Beauty: only skincare is picked from. Food and household: only a companion (coffee: a cup).
  if(says==="pet"){const p=KINDS.find(x=>x[0]==="pet");return {mode:"similar",key:p[0],noun:p[1],want:p[2]};}
  if(says==="beauty"){const b=KINDS.find(x=>x[0]==="skincare");return b[2].test(s)?{mode:"similar",key:b[0],noun:b[1],want:b[2]}:null;}
  if(says==="used"){const c=COMPANIONS.find(x=>x[0]!=="bed"&&x[2].test(s));return c?{mode:"companion",key:c[0],noun:c[1],want:c[3],better:c[4]&&c[4].test(s)?c[4]:null}:null;}
  // A thing: the word lists say which kind of thing (never "pet" or "skincare" for a jumper with a dog on it).
  const ck=coreKind(name,shop);
  const k=KINDS.find(x=>x[0]!=="pet"&&x[0]!=="skincare"&&x[2].test(s)&&fitsCore(x[0],ck));if(k)return {mode:"similar",key:k[0],noun:k[1],want:k[0]==="trainers"?new RegExp(k[2].source+"|"+TRAINER_MODELS.source):(k[3]||k[2])};
  // A name the word lists can't place but the core is sure is clothes, shoes or a bag, with no kind in the lists: nothing
  // is guessed.
  if(ck&&ck!=="footwear"&&TRAINER_MODELS.test(s))return null;
  if(TRAINER_MODELS.test(s)){const t=KINDS.find(x=>x[0]==="trainers");return {mode:"similar",key:"trainers",noun:t[1],want:new RegExp(t[2].source+"|"+TRAINER_MODELS.source)};}
  const c=COMPANIONS.find(x=>x[2].test(s));if(c)return {mode:"companion",key:c[0],noun:c[1],want:c[3],better:c[4]&&c[4].test(s)?c[4]:null};
  return null;
 }
 // What the AI made of an item name (AI for picks, worker/item-kinds.js), in the same shape as kindOf. Shoppers who switched it
 // on only; anything else falls back to the word lists above.
 const nameKey=n=>String(n||"").toLowerCase().replace(/\s+/g," ").trim().slice(0,120);
 const esc=w=>w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 function aiKindOf(name,ai){const d=ai&&ai[nameKey(name)];if(!d)return null;if(d.mode==="once")return {mode:"none"};
  const look=(Array.isArray(d.look)?d.look:[]).filter(w=>typeof w==="string"&&w);if(!d.kind||!look.length)return null;
  const want=new RegExp("\\b("+look.map(esc).join("|")+")");
  const known=KINDS.find(x=>x[1]===d.kind||x[0]===d.kind||x[1]+"s"===d.kind);
  return d.mode==="with"?{mode:"companion",key:"with:"+d.kind,noun:d.kind,want,better:null}:{mode:"similar",key:known?known[0]:d.kind,noun:d.kind,want,ai:true};}
 // A shop that sells one thing with a companion (Nespresso: coffee), when the item's own name doesn't say (Ispirazione Roma).
 function shopCompanion(shop){const s=normal(shop);const c=COMPANIONS.find(x=>x[2].test(s));return c?{mode:"companion",key:c[0],noun:c[1],want:c[3],better:c[4]&&c[4].test(s)?c[4]:null}:null;}
  const SUPERMARKETS=/\b(sainsbury'?s?|tesco|asda|morrisons|aldi|lidl|waitrose|co-?op|iceland|ocado|m ?& ?s food|spar|budgens|farmfoods)\b/;
 const possessiveShop=n=>/s$/i.test(n)?n+"'":n+"'s";
 // groups: what Browse shows, each {key, product, store, min (pence), options[], left}. Returns up to `limit` picks, best first,
 // each {g, score, why[]}. At most two of a kind (three when there's only one kind to go on), one companion per thing bought,
 // three from one shop, and never the very thing they already bought.
 //
 // It learns from what the shopper does, on their own phone (options): products they opened (taps) or watch (watched) make
 // that kind count for more, and a kind they keep looking at without buying becomes a pick of its own; "Not for me" (notFor)
 // hides that product and halves its kind each time (three times and the kind is gone); a pick shown on four days without
 // being opened (seen) drops back.
 function picks(purchases,groups,options={}){
  const limit=options.limit||6,sizes=(options.sizes||[]).map(normal).filter(Boolean);
  const looks=new Map(),lookColours=new Set(),lookShops=new Set();
  const look=(k,n)=>{if(k)looks.set(k,(looks.get(k)||0)+n)};
  for(const t of Array.isArray(options.taps)?options.taps:[]){if(!t)continue;look(t.kind,1);if(t.colour)lookColours.add(t.colour);if(t.merchant)lookShops.add(t.merchant)}
  for(const w of Array.isArray(options.watched)?options.watched:[]){const k=w&&kindOf(w.product);if(k&&k.mode!=="none")look(k.key,2)}
  const notFor=Array.isArray(options.notFor)?options.notFor.filter(Boolean):[],seen=options.seen||{};
  const hiddenKeys=new Set(notFor.map(x=>normal(x.key)).filter(Boolean)),dislike=new Map(),shopDislike=new Map();
  notFor.forEach(x=>{if(x.kind)dislike.set(x.kind,(dislike.get(x.kind)||0)+1);if(x.store)shopDislike.set(normal(x.store),(shopDislike.get(normal(x.store))||0)+1)});
  const bought=(Array.isArray(purchases)?purchases:[]).filter(p=>p&&p.item&&p.merchant&&(p.demo===true||p.verified===true));
  const src=new Map(),owned=new Set();
  for(const p of bought){
   owned.add(normal(p.merchant)+"|"+normal(p.item));
   // A line under £2 (a carrier bag, a pack of hair ties) says nothing about what someone would buy again.
   if(Number(p.price)>0&&Number(p.price)<2&&!aiKindOf(p.item,options.aiKinds))continue;
   // A supermarket's receipt is mostly the weekly shop: its lines count only as clothes or homeware that last, by the word
   // lists (or the AI), never by a shop-wide guess.
   const superm=SUPERMARKETS.test(normal(p.merchant));
   const k=aiKindOf(p.item,options.aiKinds)||kindOf(p.item,p.merchant)||(superm?null:shopCompanion(p.merchant));if(!k||k.mode==="none")continue;
   if(superm&&k.mode==="companion")continue;
   if(!src.has(k.key))src.set(k.key,{...k,n:0,colours:new Set(),shops:new Map(),prices:[]});
   const x=src.get(k.key);x.n++;if(k.better)x.better=k.better;
   // The AI's words for what to look for widen what the word lists know (yoga pants are leggings too).
   if(k.ai&&!x.ai){x.want=new RegExp(x.want.source+"|"+k.want.source);x.ai=true}
   const c=colourOf(p.detail)||colourOf(p.item);if(c)x.colours.add(c);
   x.shops.set(normal(p.merchant),String(p.merchant).trim());
   const pm=Math.round(Number(p.price||0)*100);if(pm>0)x.prices.push(pm);
  }
  // A kind they keep looking at (two looks, or one watch) without having bought it: picks of its own, weaker than a purchase.
  for(const [key,n] of looks){if(src.has(key)||n<2)continue;const k=KINDS.find(x=>x[0]===key);if(!k)continue;
   src.set(key,{mode:"similar",key,noun:k[1],want:k[3]||k[2],n:0,looked:true,colours:new Set(),shops:new Map(),prices:[]})}
  const kinds=[...src.values()].map(x=>{const lk=Math.min(looks.get(x.key)||0,4),d=dislike.get(x.key)||0;
   const base=x.looked?.6+lk*.15:x.mode==="similar"?1+Math.min(x.n,4)*.5+lk*.25:.8+lk*.1;
   return {...x,weight:d>=3?0:base*Math.pow(.5,d),paid:x.prices.length?x.prices.slice().sort((a,b)=>a-b)[Math.floor(x.prices.length/2)]:0}}).filter(x=>x.weight>0);
  if(!kinds.length)return[];
  const stock=(Array.isArray(groups)?groups:[]).filter(g=>g&&g.product&&g.left!==0&&!owned.has(normal(g.store)+"|"+normal(g.product))&&!hiddenKeys.has(normal(g.key)));
  const perKind=kinds.filter(k=>k.mode==="similar").length===1?3:2;
  const pool=kinds.map(k=>{
   const shop=[...k.shops.values()][0],many=k.shops.size>1;
   const lead=k.looked?"Like the "+k.noun+" you've been looking at":k.mode==="similar"?(many?"Like the "+k.noun+" you buy":"Like the "+k.noun+" you bought at "+shop):"Goes with your "+k.noun+(many?"":" from "+shop);
   // A product picked as more of a kind must be that kind itself, as far as the word lists can tell: Boxer Shorts aren't
   // shorts, a Knit Jacket isn't a jumper, a Cap Sleeve T-Shirt isn't a cap.
   const sameKind=g=>{if(k.mode!=="similar"||k.ai||!KINDS.some(x=>x[0]===k.key))return true;const o=kindOf(g.product,g.store);
    // And the core must not say it is another kind of thing (a black bag is never "like" black trainers).
    const ck=coreKind(g.product,g.store);if(ck&&KIND_IS[k.key]&&!fitsCore(k.key,ck))return false;
    return !o||(o.mode==="similar"&&o.key===k.key)};
   const list=stock.filter(g=>k.want.test(normal(g.product))&&sameKind(g)).map((g,i)=>{
    let s=3;const why=[lead],text=normal(g.product+" "+(g.options||[]).join(" "));
    const col=[...k.colours].find(c=>new RegExp("\\b"+c+"\\b").test(text));
    const fit=(g.options||[]).flatMap(o=>String(o).split(/\s*[\/,|]\s*/)).find(o=>sizes.includes(normal(o)));
    if(k.better&&k.better.test(normal(g.product)))s+=1;
    if(col){s+=1;why.push("In "+col+", like yours")}
    if(fit){s+=.5;if(why.length<2)why.push("In your size, "+fit)}
    if(k.shops.has(normal(g.store))){s+=1;if(why.length<2)why.push("From "+possessiveShop(k.shops.get(normal(g.store)))+" range")}
    if(k.paid&&g.min>=k.paid*.5&&g.min<=k.paid*1.6)s+=.5;
    if(!col&&[...lookColours].some(c=>new RegExp("\\b"+c+"\\b").test(text)))s+=.5;
    if(lookShops.has(normal(g.store)))s+=.5;
    s-=shopDislike.get(normal(g.store))||0;
    if((Number(seen[normal(g.key)])||Number(seen[g.key])||0)>=4)s-=1.5;
    return {g,i,k,score:s*k.weight,why};
   }).sort((a,b)=>b.score-a.score||a.i-b.i);
   return {k,list,taken:0,cap:k.mode==="companion"?1:perKind};
  }).filter(x=>x.list.length).sort((a,b)=>b.k.weight-a.k.weight||b.list[0].score-a.list[0].score);
  const out=[],perShop=new Map(),used=new Set();
  // In turns, strongest kind first, so one kind can't fill the row.
  for(let round=0;round<3&&out.length<limit;round++)for(const p of pool){
   if(out.length>=limit)break;if(p.taken>=p.cap)continue;
   const x=p.list.find(y=>!used.has(y.g.key||y.g.product+"|"+y.g.store)&&(perShop.get(normal(y.g.store))||0)<3);if(!x)continue;
   used.add(x.g.key||x.g.product+"|"+x.g.store);perShop.set(normal(x.g.store),(perShop.get(normal(x.g.store))||0)+1);p.taken++;
   out.push({g:x.g,score:x.score,why:x.why.slice(0,2),kind:x.k.key,noun:x.k.noun});
  }
  return out;
 }
 return Object.freeze({rank,category,colourOf,getHistory,tapOf,profile,sizeOf,stylesOf,headline,kindOf,aiKindOf,picks});
});
