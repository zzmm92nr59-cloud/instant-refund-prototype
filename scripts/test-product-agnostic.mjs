// Regression checks for retailer-neutral Relay catalogue, purchase & exchange flows.
// Run: node scripts/test-product-agnostic.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
const engine=require('../relay-exchange-engine.js');
const files=['index.html','relay-app-v2.html','test-store.html'];
const source=Object.fromEntries(files.map(path=>[path,readFileSync(new URL('../'+path,import.meta.url),'utf8')]));

for(const [name,html] of Object.entries(source)){
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for(let i=0;i<scripts.length;i++){
    if(scripts[i][1].trim())assert.doesNotThrow(()=>new vm.Script(scripts[i][1],{filename:name+' inline '+i}),name+' JavaScript syntax');
  }
  assert.match(html,/Everyday Crossbody Bag/);
  assert.match(html,/City Canvas Tote/);
}

const catalogue=Object.fromEntries(files.map(path=>{
  const m=source[path].match(/\{id:"north",name:"North & Co\.",prefix:"NORTH",items:\[([\s\S]*?)\]\},/);
  assert.ok(m,path+' has North & Co. demo inventory');
  return [path,vm.runInNewContext('['+m[1]+']')];
}));
assert.deepEqual(JSON.parse(JSON.stringify(catalogue['index.html'])),JSON.parse(JSON.stringify(catalogue['test-store.html'])),'store inventory and wallet catalogue must match');
assert.deepEqual(JSON.parse(JSON.stringify(catalogue['relay-app-v2.html'])),JSON.parse(JSON.stringify(catalogue['test-store.html'])),'v2 inventory and store must match');
const items=catalogue['index.html'];
const stock=(name,variation)=>{const i=items.findIndex(x=>x[0]===name&&x[1]===variation);assert.ok(i>=0, name+' '+variation+' must exist');return {sku:'DEMO-NORTH-'+String(i+1).padStart(3,'0'),product:name,variation,priceMinor:items[i][2],quantity:items[i][3],store:'North & Co.',fixture:true}};
const purchase={id:'demo-bag-purchase-1',merchant:'North & Co.',item:'Everyday Crossbody Bag',detail:'Black',price:49.99,demo:true};
const clay=stock('Everyday Crossbody Bag','Clay');
const tote=stock('City Canvas Tote','Stone');
const trainer=stock('Retro High Trainers','White / Grey / UK 7');
assert.equal(engine.category(purchase.item),'bag');
assert.equal(engine.category('Weekend Holdall'),'bag');
assert.equal(engine.matches(purchase,clay,'colour'),true,'bag colour swaps');
assert.equal(engine.matches(purchase,tote,'design'),true,'bag style swaps');
assert.equal(engine.matches(purchase,tote,'mind'),true,'changed mind returns other bags');
assert.equal(engine.matches(purchase,trainer,'design'),false,'do not suggest shoes as bags');
assert.equal(engine.matches(purchase,clay,'size'),false,'bags without sizes cannot size-swap');
assert.equal(engine.matches(purchase,{...tote,store:'Harbour Goods'},'design'),false,'cross-retailer exchanges cannot be silently assumed');
assert.equal(engine.quote({purchase,candidate:tote,reason:'design'}).refundMinor,1100,'accurate bag price difference');
assert.ok(!source['test-store.html'].includes('NORTH & CO. / FOOTWEAR'),'category labels must be dynamic');
assert.ok(source['test-store.html'].includes('id="category"'),'test store product category filter');
for(const name of ['index.html','relay-app-v2.html']){
  assert.match(source[name],/reason=RelayExchangeEngine\.sizeOf\(selected\.detail\)\?"size":"design"/,'bag default exchange design');
  assert.ok(!source[name].includes('localStorage.removeItem("relay-test-store-orders-v1");\n  localStorage.removeItem("relay-demo-orders-v1");'),'do not wipe orders in startup');
  assert.ok(!source[name].includes('.filter(p=>p.provider==="square_sandbox"&&p.sku'),'square endpoint does not send provider');
}
console.log('PASS: compiled inline app scripts, synchronized retailer inventory, bag and trainer rules, safe matching, price difference, first-run purchase preservation.');
