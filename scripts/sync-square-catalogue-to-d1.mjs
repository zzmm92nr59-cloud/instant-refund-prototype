// One-click Square Sandbox -> Relay D1 catalogue synchronisation.
// Runs inside GitHub Actions with secrets; never exposes retailer data publicly.
const squareToken=process.env.SQUARE_ACCESS_TOKEN;
const cfToken=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const database=process.env.RELAY_D1_DATABASE_ID;
if(!squareToken||!cfToken||!account||!database)throw Error("Required GitHub secrets/environment missing");
async function api(url,token,method="GET",body){
 const res=await fetch(url,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(url.includes("squareupsandbox")?{"Square-Version":"2026-09-16"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const json=await res.json();
 if(!res.ok||json.success===false||json.errors?.length)throw Error(url.split("?")[0]+" HTTP "+res.status+": "+JSON.stringify(json.errors||[]).slice(0,350));
 return json;
}
const sq=(path,method,body)=>api("https://connect.squareupsandbox.com"+path,squareToken,method,body);
async function sql(query,params=[]){
 const data=await api("https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database/"+database+"/query",cfToken,"POST",{sql:query,params});
 if(data.result?.[0]?.success===false)throw Error("D1 query failed: "+JSON.stringify(data.result[0].error));
 return data.result?.[0];
}
const locations=(await sq("/v2/locations")).locations?.filter(l=>l.id&&l.status==="ACTIVE")||[];
if(!locations.length)throw Error("No active Square Sandbox locations");
for(const location of locations)await sql("INSERT OR IGNORE INTO retailer_connections(id,provider,merchant_external_id) VALUES (?,?,?)",["square:sandbox:"+location.id,"square_sandbox",location.id]);
let cursor,products=0,variants=0,pages=0,inventoryCounts=0;
const ids=[];
do{
 const data=await sq("/v2/catalog/list?types=ITEM&limit=100"+(cursor?"&cursor="+encodeURIComponent(cursor):""));
 for(const item of data.objects||[]){
  if(item.type!=="ITEM"||!item.id)continue;
  const itemId="square:sandbox:item:"+item.id;
  await sql(`INSERT INTO retailer_catalog_items (id,provider,external_item_id,title,description) VALUES (?,?,?,?,?)
   ON CONFLICT(provider,external_item_id) DO UPDATE SET title=excluded.title,description=excluded.description,updated_at=CURRENT_TIMESTAMP`,
   [itemId,"square_sandbox",item.id,item.item_data?.name||"Unnamed item",item.item_data?.description||null]);
  products++;
  for(const variant of item.item_data?.variations||[]){
   if(!variant.id)continue;
   const vid="square:sandbox:variant:"+variant.id;
   await sql(`INSERT INTO retailer_catalog_variants(id,item_id,external_variant_id,title,sku,price_minor,currency)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(item_id,external_variant_id) DO UPDATE SET
    title=excluded.title,sku=excluded.sku,price_minor=excluded.price_minor,currency=excluded.currency,updated_at=CURRENT_TIMESTAMP`,
    [vid,itemId,variant.id,variant.item_variation_data?.name||"Default",variant.item_variation_data?.sku||null,
    variant.item_variation_data?.price_money?.amount??null,variant.item_variation_data?.price_money?.currency||null]);
   ids.push(variant.id);variants++;
  }
 }
 cursor=data.cursor||null;pages++;
}while(cursor&&pages<10);
for(let i=0;i<ids.length;i+=100){
 const data=await sq("/v2/inventory/counts/batch-retrieve","POST",{catalog_object_ids:ids.slice(i,i+100),location_ids:locations.map(l=>l.id)});
 for(const count of data.counts||[]){
  if(!count.catalog_object_id||!count.location_id)continue;
  const q=Number(count.quantity);
  await sql(`INSERT INTO retailer_inventory_snapshots(variant_id,connection_id,quantity,inventory_state) VALUES (?,?,?,?)
    ON CONFLICT(variant_id,connection_id) DO UPDATE SET quantity=excluded.quantity,inventory_state=excluded.inventory_state,observed_at=CURRENT_TIMESTAMP`,
    ["square:sandbox:variant:"+count.catalog_object_id,"square:sandbox:"+count.location_id,Number.isFinite(q)?q:null,count.state||"UNKNOWN"]);
  inventoryCounts++;
 }
}
const summary={locations:locations.length,products,variants,inventoryCounts,pages,morePages:!!cursor};
await sql("INSERT INTO audit_events(id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)",
 [crypto.randomUUID(),"system","github_action","catalogue_sync","retailer_connection","square:sandbox",JSON.stringify(summary)]);
console.log("Square Sandbox -> Relay D1 sync complete:",JSON.stringify(summary));
if(cursor)console.warn("More catalogue pages remain; importer caps at 10 pages.");
