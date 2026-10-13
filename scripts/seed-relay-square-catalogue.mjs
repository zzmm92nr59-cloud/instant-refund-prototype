// Repeatable, idempotent Square Sandbox product and stock seeding for Relay Discover/Radar.
const token=process.env.SQUARE_ACCESS_TOKEN;if(!token)throw Error("SQUARE_ACCESS_TOKEN missing");
const base="https://connect.squareupsandbox.com",headers={Authorization:"Bearer "+token,"Square-Version":"2026-09-16","Content-Type":"application/json"};
async function call(path,method="GET",body){const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok||j.errors?.length)throw Error(path+" "+JSON.stringify(j).slice(0,1000));return j}
const locations=(await call("/v2/locations")).locations||[],loc=locations.find(l=>l.status==="ACTIVE");if(!loc)throw Error("No active Square Sandbox location");
const specs=[
 ["Relay Demo Retro Trainers",["UK 7 · White/Grey","UK 8 · White/Grey","UK 9 · White/Grey","UK 8 · Black/White"],12999,["RETRO-7-WG","RETRO-8-WG","RETRO-9-WG","RETRO-8-BW"]],
 ["Relay Demo Minimalist Low Tops",["UK 7 · White","UK 8 · White","UK 9 · White","UK 8 · Black"],11999,["LOW-7-W","LOW-8-W","LOW-9-W","LOW-8-B"]],
 ["Relay Demo Suede Runners",["UK 7 · Grey","UK 8 · Grey","UK 9 · Grey","UK 8 · Cream"],13499,["SUEDE-7-G","SUEDE-8-G","SUEDE-9-G","SUEDE-8-C"]],
 ["Relay Demo Everyday Hoodie",["S · Navy","M · Navy","L · Navy","M · Stone"],6499,["HOOD-S-N","HOOD-M-N","HOOD-L-N","HOOD-M-S"]],
 ["Relay Demo Essential Tee",["S · White","M · White","L · White","M · Black"],2999,["TEE-S-W","TEE-M-W","TEE-L-W","TEE-M-B"]],
 ["Relay Demo Crossbody Bag",["Black","Sand","Olive"],4999,["BAG-B","BAG-S","BAG-O"]]
];
const existing=(await call("/v2/catalog/list?types=ITEM&limit=100")).objects||[];const created=[],skipped=[];
for(const [name,variants,price,skuSuffixes] of specs){
 if(existing.some(o=>o.item_data?.name===name)){skipped.push(name);continue}
 const itemId="#"+crypto.randomUUID().replace(/-/g,"").slice(0,16);
 const object={type:"ITEM",id:itemId,item_data:{name,description:"Relay Sandbox demonstration product. Not a real retailer offer.",variations:variants.map((v,i)=>({type:"ITEM_VARIATION",id:"#"+crypto.randomUUID().replace(/-/g,"").slice(0,16),item_variation_data:{name:v,sku:"DEMO-"+skuSuffixes[i],pricing_type:"FIXED_PRICING",price_money:{amount:price,currency:"GBP"},track_inventory:true}}))}};
 const result=await call("/v2/catalog/batch-upsert","POST",{idempotency_key:crypto.randomUUID(),batches:[{objects:[object]}]});
 const mapped=(result.objects||[]).find(x=>x.type==="ITEM");if(!mapped)throw Error("Square did not return item "+name);
 created.push({name,id:mapped.id,variants:(mapped.item_data?.variations||[]).map(v=>({id:v.id,sku:v.item_variation_data?.sku}))});
}
const all=[];let cursor;do{const d=await call("/v2/catalog/list?types=ITEM&limit=100"+(cursor?"&cursor="+encodeURIComponent(cursor):""));all.push(...d.objects||[]);cursor=d.cursor}while(cursor&&all.length<1000);
const targets=all.filter(x=>specs.some(s=>s[0]===x.item_data?.name)).flatMap(x=>x.item_data?.variations||[]).filter(v=>v.item_variation_data?.sku?.startsWith("DEMO-"));
let updated=0;for(const v of targets){const sku=v.item_variation_data.sku;const qty=sku.includes("BAG")?7:sku.includes("UK")?8:12;await call("/v2/inventory/changes/batch-create","POST",{idempotency_key:crypto.randomUUID(),changes:[{type:"PHYSICAL_COUNT",physical_count:{catalog_object_id:v.id,location_id:loc.id,state:"IN_STOCK",quantity:String(qty),occurred_at:new Date().toISOString()}}]});updated++}
console.log(JSON.stringify({location:loc.id,created,skipped,variantsStocked:updated,totalDemoVariants:targets.length},null,2));
