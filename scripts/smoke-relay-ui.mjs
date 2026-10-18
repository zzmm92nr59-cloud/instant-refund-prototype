// Fast offline rendering check. Actual DOM interactions are covered by ui-smoke-test.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const files=['index.html','relay-app-v2.html'];
assert.equal(readFileSync(files[0],'utf8'),readFileSync(files[1],'utf8'),'App entry points must stay identical');
for(const file of files){
 const html=readFileSync(file,'utf8'),elements=new Map(),store=new Map(),errors=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',style:{},classList:{toggle(){}},querySelectorAll(){return []},scrollIntoView(){}});return elements.get(id)};
 const sandbox={document:{getElementById:el,querySelectorAll:()=>[]},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},location:{search:''},URLSearchParams,console:{error:(...e)=>errors.push(e.join(' ')),warn(){},log(){}},fetch:async()=>{throw Error('Deliberately offline')},navigator:{locks:{request:async(_,fn)=>fn()}},scrollTo(){},addEventListener(){}};
 sandbox.window=sandbox;const context=vm.createContext(sandbox);
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){const src=match[1].match(/src="\.\/([^"?]+)/);vm.runInContext(src?readFileSync(src[1],'utf8'):match[2],context,{timeout:2000})}
 assert.deepEqual(errors,[]);
 assert.match(el('view').innerHTML,/Your purchases/);
 for(const tab of ['wallet','discover','radar','wrapped','profile']){sandbox.go(tab);assert.match(el('side').innerHTML,new RegExp(tab));assert.ok(el('view').innerHTML.length>100)}
 sandbox.startSample();sandbox.openPurchase('relay-sample-Ava-unit-0');assert.match(el('view').innerHTML,/INSTANT REFUND/);assert.match(el('view').innerHTML,/Swap item/);
 sandbox.page='refund';sandbox.render();assert.match(el('view').innerHTML,/refundReason/);
 sandbox.page='exchange';sandbox.render();assert.match(el('view').innerHTML,/Reason for exchange/);
 sandbox.exchangeContext=true;sandbox.go('discover');assert.match(el('catalogResults').innerHTML,/DEMO-NORTH-003/);
 console.log('PASS',file,'offline startup, five tabs, sample purchase, refund and replacement options');
}
