// Creates a SECOND LOCATION in the existing Square Sandbox seller, not a separate merchant account.
// Safe to rerun: existing location and demo SKUs are reused.
const token=process.env.SQUARE_ACCESS_TOKEN;if(!token)throw Error("SQUARE_ACCESS_TOKEN secret missing");
const base="https://connect.squareupsandbox.com",headers={Authorization:"Bearer "+token,"Square-Version":"2026-09-16","Content-Type":"application/json"};
async function req(path,method="GET",body){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok||j.errors?.length)throw Error(path+" "+JSON.stringify(j.errors||j).slice(0,600));return j}
const locs=(await req("/v2/locations")).locations||[];let loc=locs.find(x=>x.name==="Relay Studio Demo"&&x.status==="ACTIVE");
if(!loc){loc=(await req("/v2/locations","POST",{location:{name:"Relay Studio Demo",business_name:"Relay Studio Demo",description:"Second Sandbox storefront for Relay multi-store testing",type:"PHYSICAL"}})).location}
console.log("SECOND_LOCATION_ID="+loc.id+" name="+loc.name);
const items=[
 {name:"Relay Studio Canvas Tote",variants:[["Natural",3499,"DEMO-STUDIO-TOTE-NAT"],["Black",3499,"DEMO-STUDIO-TOTE-BLK"]]},
 {name:"Relay Studio Oversized Hoodie",variants:[["S · Sage",6499,"DEMO-STUDIO-HOOD-S"],["M · Sage",6499,"DEMO-STUDIO-HOOD-M"],["L · Sage",6499,"DEMO-STUDIO-HOOD-L"]]},
 {name:"Relay Studio Everyday Cap",variants:[["Stone",2499,"DEMO-STUDIO-CAP-STONE"],["Navy",2499,"DEMO-STUDIO-CAP-NAVY"]]},
 {name:"Relay Studio Weekend Shirt",variants:[["S · White",4999,"DEMO-STUDIO-SHIRT-S"],["M · White",4999,"DEMO-STUDIO-SHIRT-M"],["L · White",4999,"DEMO-STUDIO-SHIRT-L"]]}
];
const all=[];let cursor;do{const d=await req("/v2/catalog/list?types=ITEM&limit=100"+(cursor?"&cursor="+encodeURIComponent(cursor):""));all.push(...(d.objects||[]));cursor=d.cursor}while(cursor&&all.length<1000);
const existing=new Set(all.flatMap(i=>(i.item_data?.variations||[]).map(v=>v.item_variation_data?.sku)));
const objects=[];let seq=0;for(const item of items){if(item.variants.every(v=>existing.has(v[2])))continue;const itemId="#STUDIO_ITEM_"+seq++;objects.push({type:"ITEM",id:itemId,present_at_all_locations:false,present_at_location_ids:[loc.id],item_data:{name:item.name,description:"Relay Studio Sandbox demo item",variations:item.variants.map(([name,amount,sku],i)=>({type:"ITEM_VARIATION",id:"#STUDIO_VARIATION_"+seq+"_"+i,present_at_all_locations:false,present_at_location_ids:[loc.id],item_variation_data:{name,sku,pricing_type:"FIXED_PRICING",price_money:{amount,currency:"GBP"}}}))}})}
if(objects.length){const res=await req("/v2/catalog/batch-upsert","POST",{idempotency_key:crypto.randomUUID(),batches:[{objects}]});console.log("Created "+(res.objects||[]).length+" Square catalog objects")}else console.log("Studio demo SKUs already exist");
console.log("Square Studio location ready. Catalogue sync into Relay D1 is performed by the deployed Worker scheduled sync; run the deploy/sync workflow if needed.");
