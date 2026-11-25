// Offline test (Relay's real server run locally, scripts/local-worker.mjs; made-up shops and products): fixes from the
// November 2026 server review that have no test file of their own.
//  1. The public Shopify catalogue: every shop from one database query, a shop with more variants than are listed is named
//     (nothing cut without saying), test shops only for the testing tools, and the answer may be kept for a minute.
import assert from "node:assert/strict";
import { startLocalWorker } from "./local-worker.mjs";

const w = await startLocalWorker({ appOrigin: "http://127.0.0.1:1" });
const { sqlite } = w;
const get = async (path) => { const r = await fetch(w.origin + path); return { status: r.status, headers: r.headers, body: await r.json() }; };
try {
  await get("/relay/shopify/catalogue");   // makes the shop tables
  // Columns the catalogue reads add on the real database.
  for (const c of ["store_label", "image_url"]) { try { sqlite.exec("ALTER TABLE retailer_catalog_items ADD COLUMN " + c + " TEXT"); } catch { /* already there */ } }
  const shop = (domain, label, plan, variants) => {
    sqlite.prepare("INSERT INTO shopify_shops (domain, label, access_iv, access_data, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(domain, label, "iv", "data", "read_products", Date.now(), Date.now());
    if (plan !== null) sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?,?,?,0)").run(domain, plan, plan ? "partner_test" : "basic");
    const conn = "shopify:" + domain;
    for (let n = 0; n < variants; n++) {
      const name = "Thing " + String(n).padStart(3, "0");
      sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label) VALUES (?,?,?,?,?)").run(conn + ":item:" + n, conn, "p" + n, name, label);
      sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(conn + ":variant:" + n, conn + ":item:" + n, "v" + n, "Default Title", null, 1000 + n, n === 1 ? "USD" : "GBP");
    }
  };
  shop("alder-lane.myshopify.com", "Alder Lane", 0, 5);
  shop("birch-row.myshopify.com", "Birch Row", 0, 260);
  shop("relay-dev-store.myshopify.com", "Relay Dev", 1, 3);
  shop("not-checked-yet.myshopify.com", "Unchecked", null, 3);
  // Count the database queries the route makes that read products.
  let productQueries = 0;
  const prepare = w.env.RELAY_DB.prepare;
  w.env.RELAY_DB.prepare = (sql) => { if (/FROM retailer_catalog_items i\s+JOIN retailer_catalog_variants/.test(sql)) productQueries++; return prepare(sql); };
  const r = await get("/relay/shopify/catalogue");
  w.env.RELAY_DB.prepare = prepare;
  assert.equal(r.status, 200);
  assert.equal(productQueries, 1, "two shops, one query");
  assert.equal(r.body.publishedStoreCount, 2, "real shops only");
  const by = (d) => r.body.products.filter(p => p.shopDomain === d);
  assert.equal(by("alder-lane.myshopify.com").length, 4, "pounds only");
  assert.equal(by("birch-row.myshopify.com").length, 250);
  assert.deepEqual(r.body.more, ["birch-row.myshopify.com"], "a shop with more than are listed is named, not cut silently");
  assert.equal(by("relay-dev-store.myshopify.com").length + by("not-checked-yet.myshopify.com").length, 0, "no test shop's or unchecked shop's products");
  assert.ok(r.body.products.every(p => !p.testShop && p.provider === "shopify" && p.sku === p.catalogueId && p.rn === undefined));
  assert.deepEqual(by("alder-lane.myshopify.com").map(p => p.product), ["Thing 000", "Thing 002", "Thing 003", "Thing 004"], "in name order, as before");
  assert.equal(by("alder-lane.myshopify.com")[0].storeName, "Alder Lane");
  assert.match(r.headers.get("cache-control") || "", /max-age=60/, "the same answer for everyone may be kept for a minute");
  const t = await get("/relay/shopify/catalogue?test=1");
  assert.equal(t.body.publishedStoreCount, 4); assert.equal(t.body.products.filter(p => p.testShop).length, 4, "test shops only for the testing tools, each marked");
  console.log("ok - the public Shopify catalogue: one query for every shop, nothing cut without saying, real shops only");
  console.log("PASS server review fixes");
} finally { await w.close(); }
