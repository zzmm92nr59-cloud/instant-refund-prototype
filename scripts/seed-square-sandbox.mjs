// Run only in a manually dispatched GitHub Action. Sandbox catalogue writes.
import { readFileSync } from 'node:fs';
const sql=readFileSync('worker/migrations/0003_demo_inventory.sql','utf8');
const items=[...sql.matchAll(/INSERT OR IGNORE INTO retailer_catalog_items\([^\n]+VALUES\('([^']+)','relay_demo','([^']+)','([^']+)'/g)];
const variants=[...sql.matchAll(/INSERT OR IGNORE INTO retailer_catalog_variants\([^\n]+VALUES\('([^']+)','([^']+)','([^']+)','([^']+)','([^']+)',(\d+),'GBP'/g)];
const quantities=new Map([...sql.matchAll(/INSERT OR IGNORE INTO retailer_inventory_snapshots\([^\n]+VALUES\('([^']+)','([^']+)',(\d+),'IN_STOCK'/g)].map(m=>[m[1],Number(m[3])]));
const token=process.env.SQUARE_ACCESS_TOKEN;
if(!token)throw Error('SQUARE_ACCESS_TOKEN secret is missing. No catalogue changes made.');
const base='https://connect.squareupsandbox.com';
async function request(path,method='GET',body){
 const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Square-Version':'2026-09-16','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json();
 if(!res.ok||data.errors?.length)throw Error(path+' '+res.status+' '+JSON.stringify(data.errors||[]));
 return data;
}
const locations=(await request('/v2/locations')).locations?.filter(l=>l.status==='ACTIVE')||[];
if(!locations.length)throw Error('No active Square Sandbox locations.');
console.log('Active Square Sandbox locations:',locations.length);
let made=0,stocks=0;
for(const m of items){
 const [_,demoId,key,title]=m;
 const itemVariants=variants.filter(v=>v[2]===demoId);
 const objectId='#'+key.replaceAll(':','-');
 const objects=[{type:'ITEM',id:objectId,item_data:{name:'Relay Demo — '+title,
   description:'Fictional Relay integration test product',variations:itemVariants.map((v,i)=>({
    type:'ITEM_VARIATION',id:'#variation-'+key.replaceAll(':','-')+'-'+i,
    item_variation_data:{name:v[4],sku:v[5],pricing_type:'FIXED_PRICING',
      price_money:{amount:Number(v[6]),currency:'GBP'},track_inventory:true}
   }))}}];
 // Existing objects with the same SKU should not be recreated.
 // Search catalog by exact Relay Demo product name first.
 const search=await request('/v2/catalog/search','POST',{object_types:['ITEM'],
   query:{exact_query:{attribute_name:'name',attribute_value:'Relay Demo — '+title}},limit:100});
 let item=search.objects?.find(o=>o.item_data?.name==='Relay Demo — '+title);
 if(!item){
  const result=await request('/v2/catalog/batch-upsert','POST',{
   idempotency_key:crypto.randomUUID(),batches:[{objects}]});
  item=result.objects?.find(o=>o.type==='ITEM');
  if(!item)throw Error('Square did not return new item: '+title);
  made++;
 }
 // Seed physical counts via PHYSICAL_COUNT. This is a sandbox test; repeat runs
 // deliberately reset demo stock to known quantities.
 for(const variant of item.item_data?.variations||[]){
  const source=itemVariants.find(v=>v[5]===variant.item_variation_data?.sku);
  if(!source)continue;
  const quantity=quantities.get(source[1]);
  if(quantity===undefined)continue;
  for(const location of locations){
   await request('/v2/inventory/changes/batch-create','POST',{
    idempotency_key:crypto.randomUUID(),ignore_unchanged_counts:true,
    changes:[{type:'PHYSICAL_COUNT',physical_count:{catalog_object_id:variant.id,
      location_id:location.id,state:'IN_STOCK',quantity:String(quantity),
      occurred_at:new Date().toISOString()}}]});
   stocks++;
  }
 }
 console.log('Seeded:',title,'variants:',itemVariants.length);
}
console.log(JSON.stringify({newProducts:made,productsProcessed:items.length,stockCountsWritten:stocks,locations:locations.length}));
