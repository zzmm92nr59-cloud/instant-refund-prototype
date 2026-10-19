import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Load standalone Worker module without changing package-wide module mode.
const source = readFileSync(new URL("../worker/shopify.js", import.meta.url), "utf8");
const {getShopifyStores,shopifyConfigured,syncShopifyCatalogues} =
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const env={
  SHOPIFY_SHOP_DOMAIN:"old-shop.myshopify.com",
  SHOPIFY_ADMIN_ACCESS_TOKEN:"old-private-token",
  SHOPIFY_CATALOGUE_PUBLIC:"true",
  SHOPIFY_STORE_1_DOMAIN:"studio-one.myshopify.com",
  SHOPIFY_STORE_1_ADMIN_ACCESS_TOKEN:"private-token-1",
  SHOPIFY_STORE_1_CATALOGUE_PUBLIC:"true",
  SHOPIFY_STORE_1_LABEL:"Studio One",
  SHOPIFY_STORE_1_WEBHOOK_SECRET:"webhook-secret-1",
  SHOPIFY_STORE_2_DOMAIN:"studio-two.myshopify.com",
  SHOPIFY_STORE_2_ADMIN_ACCESS_TOKEN:"private-token-2",
  SHOPIFY_STORE_2_CATALOGUE_PUBLIC:"false",
  SHOPIFY_STORE_3_DOMAIN:"invalid.example.com",
  SHOPIFY_STORE_3_ADMIN_ACCESS_TOKEN:"not-valid",
  SHOPIFY_STORE_4_DOMAIN:"studio-one.myshopify.com",
  SHOPIFY_STORE_4_ADMIN_ACCESS_TOKEN:"duplicate"
};
const stores=getShopifyStores(env);
assert.equal(stores.length,3,"legacy + two distinct authorised Shopify shops");
assert.equal(shopifyConfigured(env),true);
assert.equal(stores.filter(s=>s.published).length,2);
assert.equal(stores.find(s=>s.domain==="studio-one.myshopify.com").label,"Studio One");
assert.equal(stores.find(s=>s.domain==="studio-two.myshopify.com").published,false);
assert.equal(getShopifyStores({}).length,0);
assert.equal(shopifyConfigured({}),false);

const calls=[];
env.RELAY_DB={
  prepare(sql){
    return {
      run:async()=>{calls.push({sql,values:[]})},
      bind(...values){
        return {run:async()=>{calls.push({sql,values})}};
      }
    };
  }
};
const requests=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,params)=>{
  requests.push({url,token:params.headers["X-Shopify-Access-Token"]});
  return {
    ok:true,
    json:async()=>({data:{
      shop:{currencyCode:"GBP"},
      products:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{
        id:"gid://shopify/Product/123",title:"Basic Tee",description:"",
        featuredMedia:{preview:{image:{url:"https://cdn.shopify.com/s/files/tee.jpg"}}},
        variants:{nodes:[{id:"gid://shopify/ProductVariant/55",title:"Medium",
          sku:"SAME-SKU",price:"25.99",inventoryQuantity:4}]}
      }]}
    }})
  };
};
try{
  const report=await syncShopifyCatalogues(env);
  assert.equal(report.configuredStores,3);
  assert.equal(report.results.filter(x=>x.success).length,3);
  assert.equal(requests.length,3);
  assert.equal(requests.filter(x=>x.url.includes("studio-one")).length,1);
  assert.equal(requests.find(x=>x.url.includes("studio-two")).token,"private-token-2");
  const namespacedIds=calls.filter(x=>x.sql.includes("INSERT INTO retailer_catalog_items")).map(x=>x.values[0]);
  assert.equal(new Set(namespacedIds).size,3,"same Shopify GID across stores must not collide");
  assert.ok(namespacedIds.some(x=>x.startsWith("shopify:studio-one.myshopify.com:item:")));
  assert.ok(namespacedIds.some(x=>x.startsWith("shopify:studio-two.myshopify.com:item:")));
  const namespacedVariants=calls.filter(x=>x.sql.includes("INSERT INTO retailer_catalog_variants")).map(x=>x.values[0]);
  assert.equal(new Set(namespacedVariants).size,3);
  assert.ok(!JSON.stringify(report).includes("private-token"),"never include credentials in reports");
  const imageRows=calls.filter(x=>x.sql.includes("INSERT INTO retailer_item_images"));
  assert.equal(imageRows.length,3,"retailer image link stored per product");
  assert.equal(imageRows[0].values[1],"https://cdn.shopify.com/s/files/tee.jpg");
  const outcomes=calls.filter(x=>x.sql.includes("INSERT INTO audit_events")).map(x=>JSON.parse(x.values[6]));
  assert.equal(outcomes.length,3,"one recorded outcome per store");
  assert.ok(outcomes.every(o=>o.success===true&&o.products===1&&o.images===1));
  assert.ok(!JSON.stringify(outcomes).includes("private-token"),"outcomes never include credentials");
}finally{globalThis.fetch=originalFetch}
console.log("Shopify multi-store configuration, isolation and sync tests passed");
