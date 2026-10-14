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
const html=fs.readFileSync(new URL("../index.html","file://"+__filename),"utf8");
assert.ok(html.includes('relay-recommendation-engine.js'),"App must load recommendation module");
assert.ok(html.includes('relay-discover-personalise-v1'),"Consent must be opt-in, persisted per browser");
assert.ok(html.includes('let personalise=false'),"Personalisation must default off");
assert.ok(html.includes('togglePersonalise'),"Discover needs a user-facing on/off setting");
assert.ok(html.includes('personalisationHistory(),'),"App should use the purchase history for ranking");
const script=html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(script);
new vm.Script(script[1],{filename:"Relay embedded app"});
console.log("PASS: opt-in Discover recommendation ranking, cross-shop examples, consent default, unverified exclusions, unchanged source inventory, UI integration");
