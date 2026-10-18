import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const files=["index.html","relay-app-v2.html"];
const requiredTabs=[
 ["wallet",/Your purchases|Recent purchases/i],
 ["discover",/RELAY DISCOVER|Find something better/i],
 ["radar",/RELAY RADAR|Your deals, discovered/i],
 ["wrapped",/RELAY WRAPPED|Your year in purchases/i],
 ["profile",/Your Relay profile/i]
];
let passed=0;
for(const file of files){
 const html=readFileSync(new URL("../"+file,import.meta.url),"utf8");
 assert.ok(html.includes('id="view"'),file+" missing app root");
 assert.ok(html.includes('id="side"'),file+" missing desktop navigation");
 assert.ok(html.includes('id="foot"'),file+" missing mobile navigation");
 assert.ok(/<h1 class="title">Your purchases/.test(html),file+" missing no-JS purchase fallback");
 const code=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean).at(-1);
 assert.ok(code?.length>1000,file+" missing inline app script");
 new vm.Script(code,{filename:file});
 const rendered=new Map(),elements=new Map(),errors=[],store=new Map();
 const el=id=>{
  if(!elements.has(id))elements.set(id,{
   get innerHTML(){return rendered.get(id)||""},
   set innerHTML(v){rendered.set(id,String(v))},
   textContent:"",value:"",style:{},
   classList:{add(){},remove(){},toggle(){}},
   addEventListener(){},setAttribute(){},scrollIntoView(){},
   querySelector(){return {textContent:"",style:{}}},
   querySelectorAll(){return []}
  });
  return elements.get(id);
 };
 const document={getElementById:el,querySelector:()=>el("query"),querySelectorAll:()=>[],createElement:()=>el("new")};
 const window={addEventListener(){},scrollTo(){}};
 const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const context={window,document,localStorage,fetch:async()=>{throw Error("deliberately offline smoke test")},location:{search:"",href:"https://example.invalid/",origin:"https://example.invalid"},console:{error:(...x)=>errors.push(x.map(String).join(" ")),log(){},warn(){}},alert(){},confirm:()=>true,URL,URLSearchParams,Date,Intl};
 vm.runInNewContext(code,context,{timeout:2500});
 assert.deepEqual(errors,[],file+" startup errors: "+errors.join("; "));
 assert.match(rendered.get("side")||"",/Wallet/,file+" did not render desktop navigation");
 assert.match(rendered.get("foot")||"",/Radar/,file+" did not render mobile navigation");
 for(const [tab,pattern] of requiredTabs){
  assert.equal(typeof window.go,"function",file+" missing go()");
  window.go(tab);
  assert.match(rendered.get("view")||"",pattern,file+" failed "+tab+" page");
  passed++;
 }
 assert.equal(typeof window.openPurchase,"function");
 window.openPurchase("sample-1");
 assert.match(rendered.get("view")||"",/refund|Instant/i,file+" missing refund offer in purchase");
 window.page="refund";window.render();
 assert.match(rendered.get("view")||"",/refund|advance/i,file+" missing refund flow");
 window.page="exchange";window.render();
 assert.match(rendered.get("view")||"",/exchange|size|design/i,file+" missing exchange flow");
 passed+=3;
 console.log("PASS "+file+" — navigation, five sections, refund and exchange render offline");
}
console.log("Relay UI smoke checks passed: "+passed);
