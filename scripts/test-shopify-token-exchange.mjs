import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../worker/shopify.js", import.meta.url), "utf8");
const {getShopifyStores,shopifyConfigured,getAccessToken} =
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

// Config: client id + secret alone is enough, and the secret doubles as webhook secret.
const env={SHOPIFY_SHOP_DOMAIN:"relay-ltd.myshopify.com",SHOPIFY_CLIENT_ID:"id-1",SHOPIFY_CLIENT_SECRET:"secret-1"};
const [store]=getShopifyStores(env);
assert.equal(shopifyConfigured(env),true);
assert.equal(store.canAuth,true);
assert.equal(store.webhookSecret,"secret-1");
assert.equal(shopifyConfigured({SHOPIFY_SHOP_DOMAIN:"relay-ltd.myshopify.com",SHOPIFY_CLIENT_ID:"id-only"}),false,"id without secret is not usable");

// Token exchange: fetched once, cached, refreshed near expiry. Fake fetch, no network.
let calls=[];
globalThis.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});
  return {ok:true,json:async()=>({access_token:"tok-"+calls.length,expires_in:86399})};};
const t0=1_000_000;
assert.equal(await getAccessToken(store,t0),"tok-1");
assert.equal(await getAccessToken(store,t0+3600_000),"tok-1","cached");
assert.equal(calls.length,1);
assert.equal(calls[0].url,"https://relay-ltd.myshopify.com/admin/oauth/access_token");
assert.deepEqual(calls[0].body,{client_id:"id-1",client_secret:"secret-1",grant_type:"client_credentials"});
assert.equal(await getAccessToken(store,t0+86399_000),"tok-2","refreshed before expiry");

// A static token still wins and never calls Shopify.
calls=[];
const legacy=getShopifyStores({SHOPIFY_SHOP_DOMAIN:"old.myshopify.com",SHOPIFY_ADMIN_ACCESS_TOKEN:"static"})[0];
assert.equal(await getAccessToken(legacy),"static");
assert.equal(calls.length,0);

// Failure surfaces without leaking the secret.
globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({})});
const bad=getShopifyStores({SHOPIFY_SHOP_DOMAIN:"bad.myshopify.com",SHOPIFY_CLIENT_ID:"x",SHOPIFY_CLIENT_SECRET:"super-secret"})[0];
await assert.rejects(()=>getAccessToken(bad),e=>/HTTP 400/.test(e.message)&&!/super-secret/.test(e.message));
console.log("Shopify token exchange checks passed");
