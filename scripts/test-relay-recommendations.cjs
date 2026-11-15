"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const engine=require("../relay-recommendation-engine.js");
const history=[
 {id:"A",item:"Retro High Trainers",detail:"Cream / UK 7",merchant:"North & Co.",price:129.99,demo:true},
 {id:"B",item:"City Runner Sneakers",detail:"Cream / UK 7",merchant:"Relay Studio",price:89.99,demo:true},
 {id:"C",item:"Linen Overshirt",detail:"Ecru / M",merchant:"Harbour Goods",price:64.99,demo:true},
 {id:"X",item:"Evening Gown",detail:"Purple",merchant:"Another Shop",price:149.99,demo:false} // Unverified: MUST ignore
];
const products=[
 {sku:"DEMO-1",product:"Linen Overshirt",variation:"Ecru / M",priceMinor:6499,store:"Harbour Goods",fixture:true,quantity:10},
 {sku:"DEMO-2",product:"Retro Suede Trainers",variation:"Cream / UK 8",priceMinor:12999,store:"North & Co.",fixture:true,quantity:8},
 {sku:"DEMO-3",product:"Evening Gown",variation:"Purple",priceMinor:14999,store:"Another Shop",fixture:true,quantity:8}
];
assert.equal(engine.category("Retro Suede Trainers"),"footwear");
assert.equal(engine.category("Waxed Field Coat"),"outerwear");
assert.equal(engine.colourOf("Cream / UK 8"),"cream");
assert.equal(engine.getHistory(history).length,3,"Do not personalise from unverified purchases");
const result=engine.rank(products,history);
assert.equal(result[0].sku,"DEMO-2","Cross-retailer footwear history should favour footwear alternatives");
assert.match(result[0]._relayReason,/colour|purchases/i);
const withoutHistory=engine.rank(products,[]);
assert.equal(withoutHistory[0].sku,"DEMO-1","No history should preserve original catalogue order apart from known availability");
assert.deepEqual(products.map(x=>x.sku),["DEMO-1","DEMO-2","DEMO-3"],"Inputs must not be mutated");
const contextual=engine.rank(products,history,{original:history[0],reason:"design"});
assert.equal(contextual[0].sku,"DEMO-2","Contextual design suggestions should prioritise related styles");
// Looked-at products nudge the order, but a purchase counts for more, and a tap is described honestly.
const looks=[engine.tapOf({product:"Retro Suede Trainers",variation:"Cream / UK 8",priceMinor:12999,store:"North & Co."}),engine.tapOf({product:"Retro Suede Trainers",variation:"Cream",priceMinor:12999})];
assert.equal(looks[0].category,"footwear");
const byLook=engine.rank(products,[],{interest:looks});
assert.equal(byLook[0].sku,"DEMO-2","things the shopper looked at move similar items up");
assert.match(byLook[0]._relayReason,/looked at/i);
assert.equal(engine.rank(products,[],{interest:[{category:"other",colour:null}]})[0].sku,"DEMO-1","'other' is never treated as a taste");
const prof=engine.profile(history,looks);
assert.equal(prof.bought,3);assert.equal(prof.looked,2);assert.equal(prof.categories[0].name,"footwear");assert.ok(prof.colours.some(c=>c.name==="cream"));assert.equal(prof.typicalPriceMinor,8999);
assert.equal(engine.profile([],[]).categories.length,0,"no history means no invented taste");
const html=fs.readFileSync(new URL("../index.html","file://"+__filename),"utf8");
assert.ok(html.includes('relay-recommendation-engine.js'),"App must load recommendation module");
assert.ok(html.includes('relay-discover-personalise-v1'),"Consent must be opt-in, persisted per browser");
assert.ok(html.includes('let personalise=false'),"Personalisation must default off");
assert.ok(html.includes('togglePersonalise'),"Discover needs a user-facing on/off setting");
// Picks come from the things bought, not from where the money went: a TV is a one-off (no more electronics, no phone cases),
// food picks nothing, leggings bring more leggings (the colour and shop they chose first), coffee brings one cup.
{
 const buys=[
  {item:"55 inch QLED TV",merchant:"Screen Barn",price:200,verified:true},
  {item:"Align High-Rise Pant 25",detail:"Black / 8",merchant:"Studio North",price:88,verified:true},
  {item:"Espresso capsules, 50 pack",merchant:"Bean Post",price:25,verified:true},
  {item:"Bananas",merchant:"Corner Grocer",price:1,verified:true},
  {item:"Evening Gown",detail:"Purple",merchant:"Another Shop",price:150,verified:false}];
 const g=(product,store,min,options,left)=>({key:store+"|"+product,product,store,min,options:options||[],left});
 const groups=[g("Striped Phone Case","Case Corner",3500),g("65 inch OLED TV","Screen Barn",99900),g("Seamless Leggings","Gym Row",4000,["Black / 8","Navy / 10"]),
  g("Run Leggings","Track Lane",3000,["Grey"]),g("Flow Tights","Studio North",9000,["Plum"]),g("Sold Out Leggings","Gym Row",4000,["Black"],0),
  g("Stoneware Espresso Cup","Clay Works",1200),g("Breakfast Mug","Clay Works",1400),g("Evening Gown","Another Shop",14999),g("Dark Chocolate Truffles","Cocoa Cottage",900)];
 assert.deepEqual(engine.kindOf("55 inch QLED TV"),{mode:"none"});
 assert.equal(engine.kindOf("Bananas"),null,"what Relay can't place picks nothing");
 assert.equal(engine.kindOf("Align High-Rise Pant 25").key,"leggings");
 assert.equal(engine.kindOf("Espresso capsules, 50 pack").mode,"companion");
 const got=engine.picks(buys,groups,{sizes:["8"]});
 assert.deepEqual(got.map(x=>x.g.product),["Seamless Leggings","Stoneware Espresso Cup","Flow Tights","Run Leggings"],"leggings first, one cup, three of the one kind");
 assert.deepEqual(got[0].why,["Like the leggings you bought at Studio North","In black, like yours"]);
 assert.deepEqual(got[1].why,["Goes with your coffee from Bean Post"]);
 assert.ok(got.find(x=>x.g.product==="Flow Tights").why.includes("From Studio North's range"));
 assert.deepEqual(engine.picks([buys[0],buys[3]],groups),[],"a TV and bananas pick nothing");
 assert.deepEqual(engine.picks([{item:"Seamless Leggings",merchant:"Gym Row",price:40,verified:true}],groups).map(x=>x.g.product),["Run Leggings","Flow Tights"],"never the very thing they bought");
 assert.deepEqual(engine.picks([buys[4]],groups),[],"unverified purchases are ignored");
}
assert.ok(html.includes('personalisationHistory(),'),"App should use the purchase history for ranking");
const script=html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(script);
new vm.Script(script[1],{filename:"Relay embedded app"});
console.log("PASS: opt-in Discover recommendation ranking, cross-shop examples, consent default, unverified exclusions, unchanged source inventory, picks from the things bought (one-offs and food pick nothing), UI integration");
