import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
const moduleCode=readFileSync(new URL("../worker/shopify-webhooks.js", import.meta.url),"utf8");
const { receiveShopifyWebhook }=await import("data:text/javascript;base64,"+Buffer.from(moduleCode).toString("base64"));
const secret="unit-test-secret";
const data=JSON.stringify({
 id:123456789,created_at:"2026-10-14T12:30:00+00:00",processed_at:"2026-10-14T12:31:00+00:00",
 currency:"GBP",total_price:"129.99",customer:{id:9987,email:"not-stored@example.test"},
 line_items:[{id:111,title:"Retro High Trainers",quantity:1,price:"129.99",product_id:13,variant_id:44}]
});
const sig=createHmac("sha256",secret).update(data).digest("base64");
const calls=[];
const env={
 SHOPIFY_SHOP_DOMAIN:"relay-demo.myshopify.com",
 SHOPIFY_WEBHOOK_SECRET:secret,
 RELAY_DB:{
 prepare(sql){return {bind(...args){return {sql,args}}}},
 async batch(statements){calls.push(...statements);return []}
 }
};
function req(signature=sig,shop="relay-demo.myshopify.com",body=data){
 return new Request("https://relay-square-api2.example/relay/webhooks/shopify",{
 method:"POST",headers:{
 "x-shopify-shop-domain":shop,"x-shopify-topic":"orders/paid",
 "x-shopify-hmac-sha256":signature,"x-shopify-webhook-id":"webhook-1234",
 "content-type":"application/json"},body
 });
}
let result=await receiveShopifyWebhook(req("wrong"),env);
assert.equal(result.status,401);assert.equal(calls.length,0);
result=await receiveShopifyWebhook(req(sig,"other.myshopify.com"),env);
assert.equal(result.status,403);assert.equal(calls.length,0);
result=await receiveShopifyWebhook(req(),env);
assert.equal(result.status,200);
assert.deepEqual(await result.json(),{received:true});
assert.equal(calls.length,4,"connection + order + item + audit");
assert.ok(calls.some(x=>x.sql.includes("retailer_orders")&&x.sql.includes("ON CONFLICT")));
assert.ok(calls.some(x=>x.sql.includes("order_items")&&x.sql.includes("ON CONFLICT")));
assert.ok(calls.some(x=>x.sql.includes("audit_events")));
assert.ok(!calls.some(x=>x.args.some(a=>String(a).includes("not-stored@example.test"))),"No email is stored");
const invalid=JSON.stringify({...JSON.parse(data),currency:"USD"});
result=await receiveShopifyWebhook(req(createHmac("sha256",secret).update(invalid).digest("base64"),"relay-demo.myshopify.com",invalid),env);
assert.equal(result.status,422);
console.log("PASS Shopify signed order webhook, merchant binding, private unverified ledger and validation");
