import { receiveSquareWebhook } from "./square-webhooks.js";
import { importHistoricalSquareOrders } from "./square-history.js";
import { syncSquareCatalogue } from "./square-catalogue.js";
import { shopifyConfigured, syncShopifyCatalogue } from "./shopify.js";
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(importHistoricalSquareOrders(env));
    ctx.waitUntil(syncSquareCatalogue(env));
    if (shopifyConfigured(env)) ctx.waitUntil(syncShopifyCatalogue(env));
  },
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const squareHeaders = {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": "2026-09-16",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/relay/webhooks/square" && request.method === "POST") {
      return receiveSquareWebhook(request, env, ctx);
    }

    // Read-only Sandbox catalogue suggestions. Stock is indicative, never reserved.
    if (url.pathname === "/relay/returns/sandbox-options" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({error:"Ledger unavailable"},{status:503});
      const query = (url.searchParams.get("product")||"").trim();
      if (query.length < 3 || query.length > 120)
        return Response.json({error:"Product name required"},{status:400});
      const rows = await env.RELAY_DB.prepare(`SELECT i.title AS product, v.title AS variation,
        v.sku, v.price_minor AS priceMinor, v.currency,
        s.quantity, s.observed_at AS observedAt
        FROM retailer_catalog_items i
        JOIN retailer_catalog_variants v ON v.item_id=i.id
        LEFT JOIN retailer_inventory_snapshots s ON s.variant_id=v.id
        WHERE i.provider='square_sandbox'
          AND lower(i.title)=lower(?)
        ORDER BY v.title LIMIT 50`).bind(query).all();
      return Response.json({success:true,stockIsLive:false,reservationSupported:false,
        options:(rows.results||[]).map(row=>({...row,available:Number(row.quantity)>0}))},
        {headers:{"Cache-Control":"no-store",...corsHeaders}});
    }

    // Public demo-only product selector; never exposes production merchant data.
    if (url.pathname === "/relay/live-test/products" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({products:[]},{headers:corsHeaders});
      const result = await env.RELAY_DB.prepare(`SELECT i.title AS product,v.title AS variation,
        v.sku,v.price_minor AS priceMinor,v.currency
        FROM retailer_catalog_items i JOIN retailer_catalog_variants v ON v.item_id=i.id
        WHERE i.provider='square_sandbox' AND v.sku LIKE 'DEMO-%'
        ORDER BY i.title,v.title LIMIT 100`).all();
      return Response.json({products:result.results||[]},{headers:{"Cache-Control":"no-store",...corsHeaders}});
    }

    // Sandbox-only inventory verification. No consumer or production retailer data.
    if (url.pathname === "/relay/ledger/sandbox-stock" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({error:"Ledger unavailable"},{status:503});
      const sku = url.searchParams.get("sku");
      if (!sku || !/^DEMO-[A-Z0-9-]{1,70}$/.test(sku))
        return Response.json({error:"A DEMO- SKU is required"},{status:400});
      const rows = await env.RELAY_DB.prepare(`SELECT i.title AS product, v.title AS variation,
        v.sku, s.quantity, s.inventory_state AS state, s.observed_at AS observedAt
        FROM retailer_catalog_variants v
        JOIN retailer_catalog_items i ON i.id=v.item_id
        LEFT JOIN retailer_inventory_snapshots s ON s.variant_id=v.id
        WHERE i.provider='square_sandbox' AND v.sku=?`).bind(sku).all();
      return Response.json({success:true,items:rows.results||[]},{headers:{"Cache-Control":"no-store",...corsHeaders}});
    }

    // Relay purchase ledger readiness. No personal purchase data is exposed.
    // Binding RELAY_DB is optional until the D1 database is provisioned.
    if (url.pathname === "/relay/ledger/status" && request.method === "GET") {
      if (!env.RELAY_DB) {
        return Response.json({
          success: true, ledger: "not_configured",
          nextStep: "Create Cloudflare D1 database, bind as RELAY_DB, and apply migration 0001."
        }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
      }
      try {
        const check = await env.RELAY_DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='match_candidates'"
        ).first();
        return Response.json({
          success: true, ledger: check ? "schema_ready" : "migration_required"
        }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ success: false, ledger: "unavailable" }, {
          status: 503, headers: { ...corsHeaders, "Cache-Control": "no-store" }
        });
      }
    }

    if (url.pathname === "/relay/ledger/catalogue-status" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({ success: false, error: "not_configured" }, { status: 503, headers: corsHeaders });
      try {
        const products = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM retailer_catalog_items").first();
        const variants = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM retailer_catalog_variants").first();
        const stock = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM retailer_inventory_snapshots").first();
        const last = await env.RELAY_DB.prepare(
          "SELECT created_at,metadata_json FROM audit_events WHERE event_type='catalogue_sync' ORDER BY created_at DESC LIMIT 1"
        ).first();
        return Response.json({ success: true, environment: "square_sandbox",
          products: products?.n || 0, variants: variants?.n || 0,
          inventorySnapshots: stock?.n || 0, lastSyncAt: last?.created_at || null,
          lastSync: last ? JSON.parse(last.metadata_json) : null,
          stockIsLive: false
        }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ success: false, error: "catalogue_schema_or_sync_unavailable" }, { status: 503, headers: corsHeaders });
      }
    }

    if (url.pathname === "/relay/shopify/status" && request.method === "GET") {
      return Response.json({ success: true, configured: shopifyConfigured(env),
        mode: "read_only_catalogue", historicalOrdersConnected: false,
        note: "Requires retailer-authorised Shopify Admin API credentials; demo stores are simulated."
      }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
    }

    // Public fictional catalogue only. No private Square/Shopify retailer data.
    if (url.pathname === "/relay/demo/inventory" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({ success: false, error: "not_configured" }, { status: 503, headers: corsHeaders });
      try {
        const data = await env.RELAY_DB.prepare(`SELECT
          c.merchant_external_id AS storeId, c.provider AS demoPlatform,
          p.external_item_id AS productId, p.title AS product,
          v.title AS variant, v.sku AS sku, v.price_minor AS priceMinor,
          v.currency AS currency, i.quantity AS quantity
          FROM retailer_inventory_snapshots i
          JOIN retailer_connections c ON c.id=i.connection_id
          JOIN retailer_catalog_variants v ON v.id=i.variant_id
          JOIN retailer_catalog_items p ON p.id=v.item_id
          WHERE p.provider='relay_demo' AND c.id LIKE 'demo:%'
          ORDER BY c.merchant_external_id,p.title,v.title LIMIT 200`).all();
        return Response.json({ success: true, simulated: true,
          notice: "Fictional demonstration stock only; not connected to live retailers.",
          rows: data.results || []
        }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ success: false, error: "demo_inventory_unavailable" }, { status: 503, headers: corsHeaders });
      }
    }

    // Aggregated importer status only; never expose retailer orders publicly.
    if (url.pathname === "/relay/ledger/import-status" && request.method === "GET") {
      if (!env.RELAY_DB) return Response.json({ success: false, error: "not_configured" }, { status: 503, headers: corsHeaders });
      try {
        const row = await env.RELAY_DB.prepare(
          "SELECT COUNT(*) AS order_count FROM retailer_orders WHERE connection_id LIKE 'square:sandbox:%'"
        ).first();
        const last = await env.RELAY_DB.prepare(
          "SELECT created_at,metadata_json FROM audit_events WHERE event_type = 'historical_import' ORDER BY created_at DESC LIMIT 1"
        ).first();
        const locations = await env.RELAY_DB.prepare(
          "SELECT COUNT(*) AS location_count FROM retailer_connections WHERE provider = 'square_sandbox'"
        ).first();
        return Response.json({ success: true, environment: "square_sandbox",
          importedOrderCount: row?.order_count || 0, connectedLocationCount: locations?.location_count || 0, lastImportAt: last?.created_at || null,
          lastImport: last ? JSON.parse(last.metadata_json) : null,
          ownershipVerified: false
        }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ success: false, error: "ledger_unavailable" }, { status: 503, headers: corsHeaders });
      }
    }

    // ============================================================
    // SHARED HELPERS
    // ============================================================

    async function readJsonSafely(response) {
      const text = await response.text();

      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch {
        return {
          raw: text,
        };
      }
    }

    // ============================================================
    // PLAID UK OPEN BANKING SANDBOX
    // ============================================================

    const PLAID_API_BASE =
      "https://sandbox.plaid.com";

    async function plaidPost(path, body) {
      const response = await fetch(
        `${PLAID_API_BASE}${path}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body: JSON.stringify({
            client_id:
              env.PLAID_CLIENT_ID,

            secret:
              env.PLAID_SECRET,

            ...body,
          }),
        }
      );

      const data =
        await readJsonSafely(
          response
        );

      if (!response.ok) {
        const error =
          new Error(
            data?.error_message ||
              data?.error_code ||
              `Plaid request failed with HTTP ${response.status}`
          );

        error.status =
          response.status;

        error.plaid =
          data;

        throw error;
      }

      return data;
    }

    function plaidErrorResponse(
      error,
      stage
    ) {
      return Response.json(
        {
          relayExperiment:
            "Relay UK Open Banking Purchase Matching v0.1",

          success:
            false,

          stage,

          message:
            error.message,

          plaidStatus:
            error.status || 500,

          plaidResponse:
            error.plaid || null,
        },

        {
          status:
            error.status || 500,

          headers:
            corsHeaders,
        }
      );
    }

    // ============================================================
    // PLAID CONNECT
    //
    // Visit:
    //
    // /plaid/connect?user=relay_user_001
    //
    // Creates a Link token explicitly restricted to GB.
    // ============================================================

    if (
      url.pathname ===
        "/plaid/connect" &&
      request.method ===
        "GET"
    ) {
      try {
        if (
          !env.PLAID_CLIENT_ID ||
          !env.PLAID_SECRET
        ) {
          return Response.json(
            {
              success:
                false,

              stage:
                "configuration",

              message:
                "PLAID_CLIENT_ID or PLAID_SECRET is missing from the Worker environment.",
            },

            {
              status: 500,
              headers:
                corsHeaders,
            }
          );
        }

        const relayUserId =
          url.searchParams.get(
            "user"
          ) ||
          "relay_user_001";

        const link =
          await plaidPost(
            "/link/token/create",
            {
              client_name:
                "Relay",

              user: {
                client_user_id:
                  relayUserId,
              },

              products: [
                "transactions",
              ],

              country_codes: [
                "GB",
              ],

              language:
                "en",

              transactions: {
                days_requested:
                  90,
              },
            }
          );

        if (!link.link_token) {
          return Response.json(
            {
              success:
                false,

              stage:
                "create_gb_link_token",

              message:
                "Plaid did not return a Link token.",

              plaidResponse:
                link,
            },

            {
              status: 500,
              headers:
                corsHeaders,
            }
          );
        }

        const page = `
<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>
    Relay UK Open Banking Sandbox
  </title>

  <style>
    body {
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      max-width:
        720px;

      margin:
        60px auto;

      padding:
        0 20px;

      color:
        #111;
    }

    .card {
      border:
        1px solid #ddd;

      border-radius:
        18px;

      padding:
        24px;

      box-shadow:
        0 8px 30px
        rgba(0,0,0,0.06);
    }

    button {
      font:
        inherit;

      font-weight:
        700;

      padding:
        14px 20px;

      border:
        0;

      border-radius:
        12px;

      background:
        #111;

      color:
        white;

      cursor:
        pointer;
    }

    button:hover {
      opacity:
        0.88;
    }

    pre {
      white-space:
        pre-wrap;

      word-break:
        break-word;

      background:
        #f5f5f5;

      padding:
        16px;

      border-radius:
        12px;

      margin-top:
        20px;
    }

    .muted {
      color:
        #666;
    }

    .badge {
      display:
        inline-block;

      padding:
        5px 9px;

      border-radius:
        999px;

      background:
        #eee;

      font-size:
        13px;

      margin-bottom:
        12px;
    }
  </style>
</head>

<body>

  <div class="card">

    <div class="badge">
      Relay Sandbox
    </div>

    <h1>
      UK Open Banking test
    </h1>

    <p>
      This Plaid Link session has been
      created specifically with
      <strong>country_codes: ["GB"]</strong>
      and the
      <strong>transactions</strong>
      product.
    </p>

    <button id="open">
      Connect UK sandbox bank
    </button>

    <p class="muted">
      Sandbox only. Do not enter real
      banking credentials.
    </p>

    <pre id="result">Ready.</pre>

  </div>

  <script
    src="https://cdn.plaid.com/link/v2/stable/link-initialize.js">
  </script>

  <script>
    const out =
      document.getElementById(
        "result"
      );

    const button =
      document.getElementById(
        "open"
      );

    const handler =
      Plaid.create({
        token:
          ${JSON.stringify(
            link.link_token
          )},

        onSuccess:
          async (
            public_token,
            metadata
          ) => {
            out.textContent =
              "UK sandbox bank connected. Exchanging token securely with Relay...";

            try {
              const response =
                await fetch(
                  "/plaid/exchange",
                  {
                    method:
                      "POST",

                    headers: {
                      "Content-Type":
                        "application/json"
                    },

                    body:
                      JSON.stringify({
                        public_token
                      })
                  }
                );

              const data =
                await response.json();

              out.textContent =
                JSON.stringify(
                  data,
                  null,
                  2
                );

              if (
                response.ok &&
                data.success
              ) {
                const link =
                  document.createElement(
                    "p"
                  );

                const a =
                  document.createElement(
                    "a"
                  );

                a.href =
                  "/plaid/transactions";

                a.textContent =
                  "View Relay bank transactions";

                link.appendChild(a);

                out.insertAdjacentElement(
                  "afterend",
                  link
                );
              }
            } catch (error) {
              out.textContent =
                JSON.stringify(
                  {
                    success:
                      false,

                    message:
                      error.message
                  },

                  null,
                  2
                );
            }
          },

        onExit:
          (
            error,
            metadata
          ) => {
            if (error) {
              out.textContent =
                JSON.stringify(
                  {
                    error,
                    metadata
                  },

                  null,
                  2
                );
            }
          }
      });

    button.onclick =
      () => {
        handler.open();
      };
  </script>

</body>
</html>
`;

        return new Response(
          page,

          {
            headers: {
              ...corsHeaders,

              "Content-Type":
                "text/html; charset=UTF-8",

              "Cache-Control":
                "no-store",
            },
          }
        );
      } catch (error) {
        return plaidErrorResponse(
          error,
          "create_gb_link_token"
        );
      }
    }

    // ============================================================
    // PLAID PUBLIC TOKEN EXCHANGE
    // ============================================================

    if (
      url.pathname ===
        "/plaid/exchange" &&
      request.method ===
        "POST"
    ) {
      try {
        const body =
          await request.json();

        if (!body.public_token) {
          return Response.json(
            {
              success:
                false,

              message:
                "Missing public_token.",
            },

            {
              status: 400,
              headers:
                corsHeaders,
            }
          );
        }

        const exchanged =
          await plaidPost(
            "/item/public_token/exchange",

            {
              public_token:
                body.public_token,
            }
          );

        if (
          !exchanged.access_token
        ) {
          return Response.json(
            {
              success:
                false,

              stage:
                "exchange_public_token",

              message:
                "Plaid did not return an access token.",
            },

            {
              status: 500,
              headers:
                corsHeaders,
            }
          );
        }

        const encodedAccessToken =
          encodeURIComponent(
            exchanged.access_token
          );

        return Response.json(
          {
            relayExperiment:
              "Relay UK Open Banking Purchase Matching v0.1",

            success:
              true,

            message:
              "UK Plaid Sandbox Item connected successfully.",

            itemId:
              exchanged.item_id,

            accessTokenReturnedToBrowser:
              false,

            next:
              "/plaid/transactions",
          },

          {
            headers: {
              ...corsHeaders,

              "Set-Cookie":
`relay_plaid_access=${encodedAccessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,            },
          }
        );
      } catch (error) {
        return plaidErrorResponse(
          error,
          "exchange_public_token"
        );
      }
    }

    // ============================================================
    // PLAID COOKIE HELPER
    //
    // Prototype only.
    //
    // Production Relay should store encrypted provider
    // connections server-side against the authenticated user.
    // ============================================================

    function getPlaidAccessTokenFromCookie() {
      const cookie =
        request.headers.get(
          "Cookie"
        ) || "";

      const part =
        cookie
          .split(";")
          .map(
            (value) =>
              value.trim()
          )
          .find(
            (value) =>
              value.startsWith(
                "relay_plaid_access="
              )
          );

      if (!part) {
        return null;
      }

      return decodeURIComponent(
        part.slice(
          "relay_plaid_access="
            .length
        )
      );
    }

    // ============================================================
    // PLAID TRANSACTIONS
    //
    // Visit:
    //
    // /plaid/transactions
    // ============================================================

    if (
      url.pathname ===
        "/plaid/transactions" &&
      request.method ===
        "GET"
    ) {
      try {
        const accessToken =
          getPlaidAccessTokenFromCookie();

        if (!accessToken) {
          return Response.json(
            {
              success:
                false,

              message:
                "No Plaid Sandbox Item is connected in this browser.",

              next:
                "/plaid/connect?user=relay_user_001",
            },

            {
              status: 401,
              headers:
                corsHeaders,
            }
          );
        }

        const end =
          new Date();

        const start =
          new Date(end);

        start.setDate(
          start.getDate() -
            90
        );

        const dateOnly =
          (date) =>
            date
              .toISOString()
              .slice(
                0,
                10
              );

        const data =
          await plaidPost(
            "/transactions/get",

            {
              access_token:
                accessToken,

              start_date:
                dateOnly(start),

              end_date:
                dateOnly(end),

              options: {
                count: 100,
                offset: 0,
              },
            }
          );

        return Response.json(
          {
            relayExperiment:
              "Relay UK Open Banking Purchase Matching v0.1",

            success:
              true,

            source:
              "Plaid UK Sandbox",

            accounts:
              data.accounts ||
              [],

            totalTransactions:
              data.total_transactions ||
              0,

            transactions:
              data.transactions ||
              [],

            next:
              "Create the £159.99 NORTH & CO sandbox transaction and compare it with the Square Jordans order.",
          },

          {
            headers:
              corsHeaders,
          }
        );
      } catch (error) {
        return plaidErrorResponse(
          error,
          "get_transactions"
        );
      }
    }

    // ============================================================
    // CREATE NORTH & CO TEST TRANSACTION
    //
    // POST:
    //
    // /plaid/sandbox-transaction
    //
    // Default:
    // NORTH & CO
    // £159.99 GBP
    // ============================================================

    if (
      url.pathname ===
        "/plaid/sandbox-transaction" &&
      request.method ===
        "POST"
    ) {
      try {
        const accessToken =
          getPlaidAccessTokenFromCookie();

        if (!accessToken) {
          return Response.json(
            {
              success:
                false,

              message:
                "Connect the Plaid Sandbox bank first.",

              next:
                "/plaid/connect?user=relay_user_001",
            },

            {
              status: 401,
              headers:
                corsHeaders,
            }
          );
        }

        let body = {};

        try {
          body =
            await request.json();
        } catch {
          body = {};
        }

        const today =
          new Date()
            .toISOString()
            .slice(
              0,
              10
            );

        const transaction = {
          amount:
            Number(
              body.amount ??
                159.99
            ),

          date_posted:
            body.date_posted ||
            today,

          date_transacted:
            body.date_transacted ||
            today,

          description:
            body.description ||
            "NORTH & CO",

          iso_currency_code:
            body.iso_currency_code ||
            "GBP",
        };

        const created =
          await plaidPost(
            "/sandbox/transactions/create",

            {
              access_token:
                accessToken,

              transactions: [
                transaction,
              ],
            }
          );

        return Response.json(
          {
            relayExperiment:
              "Relay UK Open Banking Purchase Matching v0.1",

            success:
              true,

            message:
              "Relay created the North & Co test bank transaction.",

            testTransaction:
              transaction,

            plaidResponse:
              created,

            next:
              "/plaid/transactions",
          },

          {
            headers:
              corsHeaders,
          }
        );
      } catch (error) {
        return plaidErrorResponse(
          error,
          "create_sandbox_transaction"
        );
      }
    }

    // ============================================================
    // HEALTH CHECK
    // ============================================================

    if (
      url.pathname === "/"
    ) {
      return Response.json(
        {
          status:
            "ok",

          service:
            "Relay API",

          integrations: {
            square:
              true,

            plaidUkSandbox:
              true,
          },

          plaidTest:
            "/plaid/connect?user=relay_user_001",
        },

        {
          headers:
            corsHeaders,
        }
      );
    }

    // ============================================================
    // SQUARE CATALOGUE LOOKUP
    // ============================================================

    async function getCatalogData(
      catalogObjectId
    ) {
      if (!catalogObjectId) {
        return {
          imageUrl: null,
          sku: null,
          parentItemId: null,
        };
      }

      try {
        const response =
          await fetch(
            `https://connect.squareupsandbox.com/v2/catalog/object/${encodeURIComponent(
              catalogObjectId
            )}?include_related_objects=true`,

            {
              method: "GET",

              headers:
                squareHeaders,
            }
          );

        if (!response.ok) {
          console.log(
            "Catalog lookup failed",
            catalogObjectId,
            response.status
          );

          return {
            imageUrl: null,
            sku: null,
            parentItemId: null,
          };
        }

        const data =
          await response.json();

        const objects = [
          data.object,

          ...(
            data.related_objects ||
            []
          ),
        ].filter(Boolean);

        let imageIds = [];

        let sku =
          null;

        let parentItemId =
          null;

        for (
          const object
          of objects
        ) {
          if (
            object.type ===
            "ITEM_VARIATION"
          ) {
            const variation =
              object
                .item_variation_data;

            if (
              variation?.image_ids
            ) {
              imageIds.push(
                ...variation
                  .image_ids
              );
            }

            if (
              !sku &&
              variation?.sku
            ) {
              sku =
                variation.sku;
            }

            if (
              !parentItemId &&
              variation?.item_id
            ) {
              parentItemId =
                variation.item_id;
            }
          }

          if (
            object.type ===
              "ITEM" &&
            object.item_data
              ?.image_ids
          ) {
            imageIds.push(
              ...object
                .item_data
                .image_ids
            );
          }
        }

        imageIds = [
          ...new Set(
            imageIds
          ),
        ];

        for (
          const imageId
          of imageIds
        ) {
          const imageObject =
            objects.find(
              (object) =>
                object.type ===
                  "IMAGE" &&
                object.id ===
                  imageId
            );

          if (
            imageObject
              ?.image_data
              ?.url
          ) {
            return {
              imageUrl:
                imageObject
                  .image_data
                  .url,

              sku,

              parentItemId,
            };
          }
        }

        if (
          imageIds.length >
          0
        ) {
          const imageResponse =
            await fetch(
              `https://connect.squareupsandbox.com/v2/catalog/object/${encodeURIComponent(
                imageIds[0]
              )}`,

              {
                method:
                  "GET",

                headers:
                  squareHeaders,
              }
            );

          if (
            imageResponse.ok
          ) {
            const imageData =
              await imageResponse
                .json();

            if (
              imageData
                .object
                ?.image_data
                ?.url
            ) {
              return {
                imageUrl:
                  imageData
                    .object
                    .image_data
                    .url,

                sku,

                parentItemId,
              };
            }
          }
        }

        return {
          imageUrl: null,
          sku,
          parentItemId,
        };
      } catch (error) {
        console.log(
          "Catalog lookup error:",
          error.message
        );

        return {
          imageUrl: null,
          sku: null,
          parentItemId: null,
        };
      }
    }

    async function getCatalogImage(
      catalogObjectId
    ) {
      const catalog =
        await getCatalogData(
          catalogObjectId
        );

      return catalog.imageUrl;
    }

    // ============================================================
    // RECENT SQUARE PURCHASES
    // ============================================================

    if (
      url.pathname ===
        "/purchases"
    ) {
      try {
        const squareResponse =
          await fetch(
            "https://connect.squareupsandbox.com/v2/orders/search",

            {
              method:
                "POST",

              headers:
                squareHeaders,

              body:
                JSON.stringify({
                  location_ids: [
                    "L8REYQ315CEM6",
                  ],

                  query: {
                    sort: {
                      sort_field:
                        "CREATED_AT",

                      sort_order:
                        "DESC",
                    },
                  },

                  limit:
                    20,

                  return_entries:
                    false,
                }),
            }
          );

        const data =
          await squareResponse
            .json();

        if (
          !squareResponse.ok
        ) {
          return Response.json(
            {
              error:
                "Square API request failed",

              squareStatus:
                squareResponse
                  .status,

              details:
                data,
            },

            {
              status:
                squareResponse
                  .status,

              headers:
                corsHeaders,
            }
          );
        }

        const purchases =
          [];

        for (
          const order
          of data.orders ||
            []
        ) {
          const items =
            [];

          for (
            const item
            of order.line_items ||
              []
          ) {
            const catalog =
              await getCatalogData(
                item
                  .catalog_object_id
              );

            items.push({
              name:
                item.name ||
                "Square item",

              variation:
                item
                  .variation_name ||
                "",

              quantity:
                item.quantity ||
                "1",

              catalogObjectId:
                item
                  .catalog_object_id ||
                null,

              parentItemId:
                catalog
                  .parentItemId,

              sku:
                catalog.sku,

              imageUrl:
                catalog
                  .imageUrl,

              price:
                item
                  .base_price_money
                  ? item
                      .base_price_money
                      .amount /
                    100
                  : null,

              currency:
                item
                  .base_price_money
                  ?.currency ||
                order
                  .total_money
                  ?.currency ||
                "GBP",
            });
          }

          purchases.push({
            orderId:
              order.id,

            locationId:
              order
                .location_id,

            createdAt:
              order
                .created_at,

            updatedAt:
              order
                .updated_at,

            state:
              order.state,

            items,

            total:
              order.total_money
                ? order
                    .total_money
                    .amount /
                  100
                : null,

            currency:
              order
                .total_money
                ?.currency ||
              "GBP",
          });
        }

        return Response.json(
          {
            source:
              "Square Sandbox",

            count:
              purchases.length,

            purchases,
          },

          {
            headers:
              corsHeaders,
          }
        );
      } catch (error) {
        return Response.json(
          {
            error:
              "Relay could not contact Square",

            message:
              error.message,
          },

          {
            status: 500,

            headers:
              corsHeaders,
          }
        );
      }
    }

    // ============================================================
    // SINGLE SQUARE ORDER
    // ============================================================

    if (
      url.pathname.startsWith(
        "/order/"
      )
    ) {
      const orderId =
        url.pathname.split(
          "/order/"
        )[1];

      if (!orderId) {
        return Response.json(
          {
            error:
              "Missing Square order ID",
          },

          {
            status: 400,

            headers:
              corsHeaders,
          }
        );
      }

      try {
        const squareResponse =
          await fetch(
            `https://connect.squareupsandbox.com/v2/orders/${encodeURIComponent(
              orderId
            )}`,

            {
              method:
                "GET",

              headers:
                squareHeaders,
            }
          );

        const data =
          await squareResponse
            .json();

        if (
          !squareResponse.ok
        ) {
          return Response.json(
            {
              error:
                "Square API request failed",

              squareStatus:
                squareResponse
                  .status,

              details:
                data,
            },

            {
              status:
                squareResponse
                  .status,

              headers:
                corsHeaders,
            }
          );
        }

        const order =
          data.order;

        if (!order) {
          return Response.json(
            {
              error:
                "Square returned no order.",
            },

            {
              status: 404,

              headers:
                corsHeaders,
            }
          );
        }

        const items =
          [];

        for (
          const item
          of order.line_items ||
            []
        ) {
          const catalog =
            await getCatalogData(
              item
                .catalog_object_id
            );

          items.push({
            name:
              item.name ||
              "Square item",

            variation:
              item
                .variation_name ||
              "",

            quantity:
              item.quantity ||
              "1",

            catalogObjectId:
              item
                .catalog_object_id ||
              null,

            parentItemId:
              catalog
                .parentItemId,

            sku:
              catalog.sku,

            imageUrl:
              catalog
                .imageUrl,

            price:
              item
                .base_price_money
                ? item
                    .base_price_money
                    .amount /
                  100
                : null,

            currency:
              item
                .base_price_money
                ?.currency ||
              order
                .total_money
                ?.currency ||
              "GBP",
          });
        }

        const relayPurchase =
          {
            orderId:
              order.id,

            locationId:
              order
                .location_id,

            createdAt:
              order
                .created_at,

            updatedAt:
              order
                .updated_at,

            state:
              order.state,

            items,

            total:
              order.total_money
                ? order
                    .total_money
                    .amount /
                  100
                : null,

            currency:
              order
                .total_money
                ?.currency ||
              "GBP",
          };

        return Response.json(
          relayPurchase,

          {
            headers:
              corsHeaders,
          }
        );
      } catch (error) {
        return Response.json(
          {
            error:
              "Relay could not contact Square",

            message:
              error.message,
          },

          {
            status: 500,

            headers:
              corsHeaders,
          }
        );
      }
    }

    // ============================================================
    // RELAY PURCHASE MATCHING EXPERIMENT
    //
    // This does NOT claim that amount alone is sufficient
    // for production matching.
    //
    // It is simply our first controlled experiment:
    //
    // Plaid bank transaction
    //       +
    // Square merchant order
    //       =
    // candidate purchase match.
    // ============================================================

    if (
      url.pathname ===
        "/relay/match-test" &&
      request.method ===
        "GET"
    ) {
      try {
        const accessToken =
          getPlaidAccessTokenFromCookie();

        if (!accessToken) {
          return Response.json(
            {
              success:
                false,

              message:
                "Connect the UK Plaid Sandbox bank first.",

              next:
                "/plaid/connect?user=relay_user_001",
            },

            {
              status: 401,

              headers:
                corsHeaders,
            }
          );
        }

        const end =
          new Date();

        const start =
          new Date(end);

        start.setDate(
          start.getDate() -
            90
        );

        const dateOnly =
          (date) =>
            date
              .toISOString()
              .slice(
                0,
                10
              );

        const plaidData =
          await plaidPost(
            "/transactions/get",

            {
              access_token:
                accessToken,

              start_date:
                dateOnly(start),

              end_date:
                dateOnly(end),

              options: {
                count: 100,
                offset: 0,
              },
            }
          );

        const squareResponse =
          await fetch(
            "https://connect.squareupsandbox.com/v2/orders/search",

            {
              method:
                "POST",

              headers:
                squareHeaders,

              body:
                JSON.stringify({
                  location_ids: [
                    "L8REYQ315CEM6",
                  ],

                  query: {
                    sort: {
                      sort_field:
                        "CREATED_AT",

                      sort_order:
                        "DESC",
                    },
                  },

                  limit:
                    20,

                  return_entries:
                    false,
                }),
            }
          );

        const squareData =
          await squareResponse
            .json();

        if (
          !squareResponse.ok
        ) {
          return Response.json(
            {
              success:
                false,

              stage:
                "square_orders",

              details:
                squareData,
            },

            {
              status:
                squareResponse
                  .status,

              headers:
                corsHeaders,
            }
          );
        }

        const transactions =
          plaidData
            .transactions ||
          [];

        const orders =
          squareData.orders ||
          [];

        const matches =
          [];

        for (
          const transaction
          of transactions
        ) {
          const bankAmount =
            Math.abs(
              Number(
                transaction.amount
              )
            );

          const merchantText =
            [
              transaction.name,
              transaction
                .merchant_name,

              transaction
                .original_description,
            ]
              .filter(Boolean)
              .join(" ")
              .toUpperCase();

          for (
            const order
            of orders
          ) {
            const orderAmount =
              order.total_money
                ? Number(
                    order
                      .total_money
                      .amount
                  ) / 100
                : null;

            if (
              orderAmount ===
              null
            ) {
              continue;
            }

            const amountMatches =
              Math.abs(
                bankAmount -
                  orderAmount
              ) < 0.01;

            if (!amountMatches) {
              continue;
            }

            const merchantLooksRight =
              merchantText.includes(
                "NORTH"
              ) ||
              merchantText.includes(
                "CO"
              );

            const items =
              [];

            for (
              const item
              of order
                .line_items ||
                []
            ) {
              const catalog =
                await getCatalogData(
                  item
                    .catalog_object_id
                );

              items.push({
                name:
                  item.name ||
                  "Square item",

                variation:
                  item
                    .variation_name ||
                  "",

                sku:
                  catalog.sku,

                price:
                  item
                    .base_price_money
                    ? Number(
                        item
                          .base_price_money
                          .amount
                      ) /
                      100
                    : null,

                imageUrl:
                  catalog
                    .imageUrl,
              });
            }

            let confidence =
              60;

            const reasons = [
              "Exact amount match",
            ];

            if (
              merchantLooksRight
            ) {
              confidence +=
                25;

              reasons.push(
                "Bank descriptor resembles North & Co"
              );
            }

            const transactionDate =
              transaction.date
                ? new Date(
                    transaction.date
                  )
                : null;

            const orderDate =
              order.created_at
                ? new Date(
                    order.created_at
                  )
                : null;

            let dayDifference =
              null;

            if (
              transactionDate &&
              orderDate &&
              !Number.isNaN(
                transactionDate
                  .getTime()
              ) &&
              !Number.isNaN(
                orderDate
                  .getTime()
              )
            ) {
              dayDifference =
                Math.abs(
                  transactionDate -
                    orderDate
                ) /
                (
                  1000 *
                  60 *
                  60 *
                  24
                );

              if (
                dayDifference <=
                3
              ) {
                confidence +=
                  15;

                reasons.push(
                  "Transaction and order dates are close"
                );
              }
            }

            confidence =
              Math.min(
                confidence,
                100
              );

            matches.push({
              confidence,

              reasons,

              bankTransaction: {
                transactionId:
                  transaction
                    .transaction_id,

                name:
                  transaction.name,

                merchantName:
                  transaction
                    .merchant_name ||
                  null,

                amount:
                  bankAmount,

                currency:
                  transaction
                    .iso_currency_code ||
                  transaction
                    .unofficial_currency_code ||
                  null,

                date:
                  transaction.date,
              },

              squareOrder: {
                orderId:
                  order.id,

                state:
                  order.state,

                createdAt:
                  order
                    .created_at,

                amount:
                  orderAmount,

                currency:
                  order
                    .total_money
                    ?.currency ||
                  "GBP",

                items,
              },

              warning:
                "Prototype candidate match only. Production Relay must use stronger shared identifiers and confidence signals before assigning a purchase to a user.",
            });
          }
        }

        matches.sort(
          (a, b) =>
            b.confidence -
            a.confidence
        );

        return Response.json(
          {
            relayExperiment:
              "Relay Purchase Identity Engine v0.1",

            success:
              true,

            plaidTransactionCount:
              transactions.length,

            squareOrderCount:
              orders.length,

            candidateMatchCount:
              matches.length,

            matches,
          },

          {
            headers:
              corsHeaders,
          }
        );
      } catch (error) {
        return Response.json(
          {
            relayExperiment:
              "Relay Purchase Identity Engine v0.1",

            success:
              false,

            message:
              error.message,

            plaidResponse:
              error.plaid ||
              null,
          },

          {
            status:
              error.status ||
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }

       // ============================================================
    // RELAY PURCHASE IDENTITY TEST LAB
    // ============================================================
        // ============================================================
    // RELAY PURCHASE IDENTITY TEST LAB
    // ============================================================
    //
    // Routes:
    //
    // GET  /relay/test-lab
    // POST /relay/test-lab/register-card
    // POST /relay/test-lab/clear-card
    // POST /relay/test-lab/setup
    // POST /relay/test-lab/square-collisions
    // GET  /relay/test-lab/run
    //
    // Sandbox only.
    // No real money.
    // No full card number is stored.
    // ============================================================


    // ============================================================
    // TEST LAB COOKIE HELPERS
    // ============================================================

    function getCookieValue(name) {

      const cookieHeader =
        request.headers.get("Cookie") || "";

      const cookies =
        cookieHeader
          .split(";")
          .map(
            value =>
              value.trim()
          );

      const prefix =
        `${name}=`;

      const cookie =
        cookies.find(
          value =>
            value.startsWith(prefix)
        );

      if (!cookie) {
        return null;
      }

      return decodeURIComponent(
        cookie.slice(prefix.length)
      );
    }


    function getRegisteredRelayCard() {

      const encoded =
        getCookieValue(
          "relay_registered_card"
        );

      if (!encoded) {
        return null;
      }

      try {

        const card =
          JSON.parse(encoded);

        if (
          !card ||
          !card.brand ||
          !card.last4
        ) {
          return null;
        }

        return {
          brand:
            String(card.brand)
              .toUpperCase(),

          last4:
            String(card.last4),

          registeredAt:
            card.registeredAt ||
            null,
        };

      } catch {

        return null;
      }
    }


    function normalizeCardBrand(value) {

      const brand =
        String(value || "")
          .trim()
          .toUpperCase();

      if (
        brand === "VISA"
      ) {
        return "VISA";
      }

      if (
        brand === "MASTERCARD" ||
        brand === "MASTER CARD"
      ) {
        return "MASTERCARD";
      }

      if (
        brand === "AMEX" ||
        brand === "AMERICAN EXPRESS"
      ) {
        return "AMERICAN_EXPRESS";
      }

      return brand;
    }


    // ============================================================
    // TEST LAB HOME PAGE
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab" &&
      request.method ===
        "GET"
    ) {

      const registeredCard =
        getRegisteredRelayCard();

      const page = `
<!doctype html>
<html lang="en">

<head>

  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>
    Relay Purchase Identity Test Lab
  </title>

  <style>

    * {
      box-sizing: border-box;
    }

    body {
      font-family:
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      margin: 0;
      background: #f5f5f5;
      color: #111;
    }

    .wrap {
      max-width: 1100px;
      margin: 50px auto;
      padding: 0 20px;
    }

    .hero,
    .card-panel {
      background: white;
      border-radius: 22px;
      padding: 30px;
      box-shadow:
        0 10px 40px
        rgba(0,0,0,0.06);
      margin-bottom: 20px;
    }

    h1 {
      margin-top: 0;
      font-size: 34px;
    }

    h2 {
      margin-top: 0;
    }

    p {
      line-height: 1.6;
    }

    .eyebrow {
      color: #666;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }

    .buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 22px;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 14px 20px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      background: #111;
      color: white;
    }

    button.secondary {
      background: #e8e8e8;
      color: #111;
    }

    button.danger {
      background: #f2dddd;
      color: #7a1111;
    }

    button:disabled {
      opacity: 0.5;
      cursor: wait;
    }

    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 12px;
      background: #f2f2f2;
      white-space: pre-wrap;
    }

    .summary {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(170px, 1fr)
        );
      gap: 14px;
      margin: 20px 0;
    }

    .metric {
      background: white;
      border-radius: 18px;
      padding: 20px;
      box-shadow:
        0 5px 25px
        rgba(0,0,0,0.05);
    }

    .metric strong {
      display: block;
      font-size: 30px;
      margin-top: 5px;
    }

    .result {
      background: white;
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 12px;
      box-shadow:
        0 5px 25px
        rgba(0,0,0,0.05);
    }

    .badge {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 10px;
    }

    .MATCHED {
      background: #dff7e8;
      color: #126532;
    }

    .AMBIGUOUS {
      background: #fff1c9;
      color: #7a5600;
    }

    .REJECTED {
      background: #ffe1e1;
      color: #8a1c1c;
    }

    .details {
      color: #555;
      font-size: 14px;
      line-height: 1.6;
    }

    .candidate {
      background: #f7f7f7;
      padding: 14px;
      border-radius: 12px;
      margin-top: 10px;
    }

    .candidate-evidence {
      margin-top: 8px;
      font-size: 13px;
      color: #555;
      line-height: 1.6;
    }

    .small {
      color: #666;
      font-size: 13px;
    }

    .card-form {
      display: grid;
      grid-template-columns:
        1fr 1fr auto;
      gap: 12px;
      align-items: end;
      margin-top: 20px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 7px;
    }

    select,
    input {
      width: 100%;
      border: 1px solid #ccc;
      border-radius: 12px;
      padding: 13px;
      font: inherit;
      background: white;
    }

    .registered {
      background: #edf8f1;
      border: 1px solid #c8ead5;
      padding: 16px;
      border-radius: 14px;
      margin-top: 18px;
    }

    .not-registered {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 14px;
      margin-top: 18px;
    }

    .signal-grid {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(190px, 1fr)
        );
      gap: 10px;
      margin-top: 18px;
    }

    .signal {
      background: #f7f7f7;
      padding: 12px;
      border-radius: 12px;
      font-size: 13px;
    }

    @media (
      max-width: 720px
    ) {

      .card-form {
        grid-template-columns: 1fr;
      }
    }

  </style>

</head>

<body>

<div class="wrap">

  <div class="hero">

    <div class="eyebrow">
      RELAY SANDBOX
    </div>

    <h1>
      Purchase Identity Test Lab
    </h1>

    <p>
      Relay is testing whether a consumer bank
      transaction can be reconciled with the correct
      item-level retailer order.
    </p>

    <p>
      The experiment now considers
      <strong>
        merchant + amount + authorisation time +
        retailer location + registered card evidence
      </strong>
      where those signals are available.
    </p>

    <div class="buttons">

      <button
        id="setup"
        onclick="setupLab()"
      >
        1. Generate bank stress test
      </button>

      <button
        class="secondary"
        id="square"
        onclick="createSquareCollisions()"
      >
        2. Generate Square collisions
      </button>

      <button
        class="secondary"
        id="run"
        onclick="runLab()"
      >
        3. Run Relay matching engine
      </button>

    </div>

    <div
      class="status"
      id="status"
    >
      Ready.
    </div>

  </div>


  <div class="card-panel">

    <div class="eyebrow">
      RELAY PAYMENT IDENTITY
    </div>

    <h2>
      Register a payment card
    </h2>

    <p>
      Prototype only. Relay stores
      <strong>
        card brand and last four digits only
      </strong>.
      Do not enter a full card number.
    </p>

    ${
      registeredCard
        ? `
          <div class="registered">

            <strong>
              ✓ Card registered with Relay
            </strong>

            <br><br>

            ${registeredCard.brand}
            ••••
            ${registeredCard.last4}

            <div class="small">
              Relay can now compare this identity
              against card evidence returned by
              participating retailer payment systems.
            </div>

          </div>
        `
        : `
          <div class="not-registered">

            No payment card is currently registered
            with this Relay Sandbox user.

          </div>
        `
    }

    <div class="card-form">

      <div>

        <label for="brand">
          Card brand
        </label>

        <select id="brand">

          <option value="VISA">
            Visa
          </option>

          <option value="MASTERCARD">
            Mastercard
          </option>

          <option value="AMERICAN_EXPRESS">
            American Express
          </option>

        </select>

      </div>

      <div>

        <label for="last4">
          Last four digits
        </label>

        <input
          id="last4"
          inputmode="numeric"
          maxlength="4"
          placeholder="4242"
          autocomplete="off"
        >

      </div>

      <button
        onclick="registerCard()"
      >
        Register card
      </button>

    </div>

    ${
      registeredCard
        ? `
          <div class="buttons">

            <button
              class="danger"
              onclick="clearCard()"
            >
              Remove registered card
            </button>

          </div>
        `
        : ""
    }

    <div class="signal-grid">

      <div class="signal">
        <strong>Merchant</strong>
        <br>
        North & Co
      </div>

      <div class="signal">
        <strong>Amount</strong>
        <br>
        £159.99
      </div>

      <div class="signal">
        <strong>Time</strong>
        <br>
        Payment authorisation
      </div>

      <div class="signal">
        <strong>Location</strong>
        <br>
        Square location/store
      </div>

      <div class="signal">
        <strong>Card identity</strong>
        <br>
        Brand + last four
      </div>

    </div>

  </div>


  <div id="summary"></div>

  <div id="results"></div>

</div>


<script>

  const statusBox =
    document.getElementById(
      "status"
    );

  const summaryBox =
    document.getElementById(
      "summary"
    );

  const resultsBox =
    document.getElementById(
      "results"
    );


  async function registerCard() {

    const brand =
      document.getElementById(
        "brand"
      ).value;

    const last4 =
      document.getElementById(
        "last4"
      ).value.trim();


    if (
      !/^\\d{4}$/.test(last4)
    ) {

      statusBox.textContent =
        "Enter exactly four digits. Do not enter a full card number.";

      return;
    }


    statusBox.textContent =
      "Registering payment identity with Relay...";


    try {

      const response =
        await fetch(
          "/relay/test-lab/register-card",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                brand,
                last4,
              }),
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        statusBox.textContent =
          JSON.stringify(
            data,
            null,
            2
          );

        return;
      }


      statusBox.textContent =
        "Card registered. Reloading Relay...";


      window.location.reload();


    } catch (error) {

      statusBox.textContent =
        "Error: " +
        error.message;
    }
  }


  async function clearCard() {

    statusBox.textContent =
      "Removing registered card...";


    try {

      const response =
        await fetch(
          "/relay/test-lab/clear-card",
          {
            method: "POST",
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        statusBox.textContent =
          JSON.stringify(
            data,
            null,
            2
          );

        return;
      }


      window.location.reload();


    } catch (error) {

      statusBox.textContent =
        "Error: " +
        error.message;
    }
  }


  async function setupLab() {

    const button =
      document.getElementById(
        "setup"
      );

    button.disabled = true;

    statusBox.textContent =
      "Creating Sandbox bank transactions...";


    try {

      const response =
        await fetch(
          "/relay/test-lab/setup",
          {
            method: "POST",
          }
        );


      const data =
        await response.json();


      statusBox.textContent =
        JSON.stringify(
          data,
          null,
          2
        );


    } catch (error) {

      statusBox.textContent =
        "Error: " +
        error.message;
    }


    button.disabled = false;
  }


  async function createSquareCollisions() {

    const button =
      document.getElementById(
        "square"
      );

    button.disabled = true;

    statusBox.textContent =
      "Creating deliberately duplicated Square Sandbox orders...";


    try {

      const response =
        await fetch(
          "/relay/test-lab/square-collisions",
          {
            method: "POST",
          }
        );


      const data =
        await response.json();


      statusBox.textContent =
        JSON.stringify(
          data,
          null,
          2
        );


    } catch (error) {

      statusBox.textContent =
        "Error: " +
        error.message;
    }


    button.disabled = false;
  }


  async function runLab() {

    const button =
      document.getElementById(
        "run"
      );

    button.disabled = true;

    statusBox.textContent =
      "Running Relay Purchase Identity Engine...";

    summaryBox.innerHTML = "";
    resultsBox.innerHTML = "";


    try {

      const response =
        await fetch(
          "/relay/test-lab/run"
        );


      const data =
        await response.json();


      if (!response.ok) {

        statusBox.textContent =
          JSON.stringify(
            data,
            null,
            2
          );

        button.disabled = false;

        return;
      }


      statusBox.textContent =
        "Test complete.";


      summaryBox.innerHTML = \`

        <div class="summary">

          <div class="metric">
            Transactions
            <strong>
              \${data.transactionCount}
            </strong>
          </div>

          <div class="metric">
            Square orders
            <strong>
              \${data.squareOrderCount}
            </strong>
          </div>

          <div class="metric">
            Square payments
            <strong>
              \${data.squarePaymentCount}
            </strong>
          </div>

          <div class="metric">
            Matched
            <strong>
              \${data.summary.matched}
            </strong>
          </div>

          <div class="metric">
            Ambiguous
            <strong>
              \${data.summary.ambiguous}
            </strong>
          </div>

          <div class="metric">
            Rejected
            <strong>
              \${data.summary.rejected}
            </strong>
          </div>

        </div>

      \`;


      for (
        const result
        of data.results
      ) {

        const candidates =
          result.candidates
            .map(
              candidate => \`

                <div class="candidate">

                  <strong>
                    \${escapeHtml(
                      candidate.itemNames.join(", ")
                    )}
                  </strong>

                  — £\${candidate.amount.toFixed(2)}

                  <br>

                  Score:
                  <strong>
                    \${candidate.score}
                  </strong>

                  <div class="candidate-evidence">

                    \${escapeHtml(
                      candidate.reasons.join(" • ")
                    )}

                    <br>

                    Square location:
                    \${escapeHtml(
                      candidate.square.locationId ||
                      "unknown"
                    )}

                    <br>

                    Payment attached:
                    \${candidate.square.paymentFound
                      ? "yes"
                      : "no"}

                    <br>

                    Square card:
                    \${escapeHtml(
                      candidate.square.cardBrand ||
                      "unknown"
                    )}
                    \${candidate.square.cardLast4
                      ? " •••• " +
                        escapeHtml(
                          candidate.square.cardLast4
                        )
                      : ""}

                    <br>

                    Registered-card match:
                    \${candidate.registeredCardMatch === true
                      ? "YES"
                      : candidate.registeredCardMatch === false
                        ? "NO"
                        : "not available"}

                    <br>

                    Time difference:
                    \${candidate.minuteDifference !== null
                      ? candidate.minuteDifference +
                        " minutes"
                      : "precise timestamps unavailable"}

                  </div>

                </div>

              \`
            )
            .join("");


        resultsBox.innerHTML += \`

          <div class="result">

            <span
              class="badge \${result.status}"
            >
              \${result.status}
            </span>

            <h2>

              \${escapeHtml(
                result.bank.name
              )}

              — £\${result.bank.amount.toFixed(2)}

            </h2>

            <div class="details">

              Date:
              \${escapeHtml(
                result.bank.date ||
                "Unknown"
              )}

              <br>

              Decision:
              <strong>
                \${escapeHtml(
                  result.decision
                )}
              </strong>

              <br>

              Candidate orders:
              \${result.candidates.length}

            </div>

            \${candidates}

          </div>

        \`;
      }


    } catch (error) {

      statusBox.textContent =
        "Error: " +
        error.message;
    }


    button.disabled = false;
  }


  function escapeHtml(value) {

    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

</script>

</body>

</html>
`;


      return new Response(
        page,
        {
          headers: {
            ...corsHeaders,

            "Content-Type":
              "text/html; charset=UTF-8",

            "Cache-Control":
              "no-store",
          },
        }
      );
    }


    // ============================================================
    // REGISTER CARD WITH RELAY
    // ============================================================
    //
    // Prototype:
    // stores ONLY brand + last four.
    //
    // Never accepts or stores a full PAN.
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab/register-card" &&
      request.method ===
        "POST"
    ) {

      try {

        const body =
          await request.json();


        const brand =
          normalizeCardBrand(
            body.brand
          );


        const last4 =
          String(
            body.last4 || ""
          ).trim();


        const allowedBrands = [
          "VISA",
          "MASTERCARD",
          "AMERICAN_EXPRESS",
        ];


        if (
          !allowedBrands.includes(
            brand
          )
        ) {

          return Response.json(
            {
              success: false,

              message:
                "Unsupported card brand.",
            },
            {
              status: 400,
              headers:
                corsHeaders,
            }
          );
        }


        if (
          !/^\d{4}$/.test(
            last4
          )
        ) {

          return Response.json(
            {
              success: false,

              message:
                "Relay only needs the last four digits. Enter exactly four digits.",
            },
            {
              status: 400,
              headers:
                corsHeaders,
            }
          );
        }


        const cardIdentity = {

          brand,

          last4,

          registeredAt:
            new Date()
              .toISOString(),
        };


        const encoded =
          encodeURIComponent(
            JSON.stringify(
              cardIdentity
            )
          );


        return Response.json(
          {
            relayExperiment:
              "Relay Registered Payment Identity v0.1",

            success: true,

            message:
              "Payment card registered with Relay.",

            card: {
              brand,
              last4,
            },

            fullCardStored:
              false,
          },
          {
            headers: {
              ...corsHeaders,

              "Set-Cookie":
                `relay_registered_card=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
            },
          }
        );


      } catch (error) {

        return Response.json(
          {
            success: false,

            message:
              error.message,
          },
          {
            status: 500,

            headers:
              corsHeaders,
          }
        );
      }
    }


    // ============================================================
    // REMOVE REGISTERED CARD
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab/clear-card" &&
      request.method ===
        "POST"
    ) {

      return Response.json(
        {
          success: true,

          message:
            "Registered Relay card removed.",
        },
        {
          headers: {
            ...corsHeaders,

            "Set-Cookie":
              "relay_registered_card=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
          },
        }
      );
    }


    // ============================================================
    // TEST LAB SETUP
    // ============================================================
    //
    // Creates intentionally messy fake Plaid transactions.
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab/setup" &&
      request.method ===
        "POST"
    ) {

      try {

        const accessToken =
          getPlaidAccessTokenFromCookie();


        if (!accessToken) {

          return Response.json(
            {
              success: false,

              message:
                "Connect the UK Plaid Sandbox bank first.",

              next:
                "/plaid/connect?user=relay_user_001",
            },
            {
              status: 401,

              headers:
                corsHeaders,
            }
          );
        }


        const dateString =
          (offsetDays) => {

            const date =
              new Date();

            date.setDate(
              date.getDate() +
              offsetDays
            );

            return date
              .toISOString()
              .slice(0, 10);
          };


        const testTransactions = [

          // Jordans collisions

          {
            amount: 159.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 159.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 159.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(-1),
            date_transacted:
              dateString(-1),
            iso_currency_code:
              "GBP",
          },


          // Shirt collisions

          {
            amount: 129.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 129.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },


          // Correct amount, wrong merchant

          {
            amount: 159.99,
            description:
              "OTHER RETAILER",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 129.99,
            description:
              "ANOTHER SHOP",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },


          // Near amounts

          {
            amount: 160.00,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 159.98,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 130.00,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },


          // No Square equivalent

          {
            amount: 79.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 259.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 49.50,
            description:
              "NORTH & CO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },


          // Correct amount but old date

          {
            amount: 159.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(-10),
            date_transacted:
              dateString(-10),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 129.99,
            description:
              "NORTH & CO",
            date_posted:
              dateString(-14),
            date_transacted:
              dateString(-14),
            iso_currency_code:
              "GBP",
          },


          // Unrelated purchases

          {
            amount: 22.40,
            description:
              "TESCO",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 7.95,
            description:
              "PRET A MANGER",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 84.00,
            description:
              "NIKE",
            date_posted:
              dateString(-1),
            date_transacted:
              dateString(-1),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 159.99,
            description:
              "NIKE",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 129.99,
            description:
              "JD SPORTS",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 42.00,
            description:
              "AMAZON",
            date_posted:
              dateString(-2),
            date_transacted:
              dateString(-2),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 18.75,
            description:
              "UBER",
            date_posted:
              dateString(-1),
            date_transacted:
              dateString(-1),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 95.00,
            description:
              "ASOS",
            date_posted:
              dateString(-3),
            date_transacted:
              dateString(-3),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 159.99,
            description:
              "APPLE",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },

          {
            amount: 129.99,
            description:
              "ARGOS",
            date_posted:
              dateString(0),
            date_transacted:
              dateString(0),
            iso_currency_code:
              "GBP",
          },
        ];


        const created = [];
        const failed = [];


        for (
          let i = 0;
          i < testTransactions.length;
          i++
        ) {

          const transaction =
            testTransactions[i];


          try {

            const result =
              await plaidPost(
                "/sandbox/transactions/create",
                {
                  access_token:
                    accessToken,

                  transactions: [
                    transaction,
                  ],
                }
              );


            created.push({
              number:
                i + 1,

              transaction,

              plaidResponse:
                result,
            });


          } catch (error) {

            failed.push({
              number:
                i + 1,

              transaction,

              error:
                error.message,

              plaid:
                error.plaid ||
                null,
            });
          }
        }


        return Response.json(
          {
            relayExperiment:
              "Relay Purchase Identity Stress Test v0.2",

            success:
              failed.length === 0,

            requested:
              testTransactions.length,

            created:
              created.length,

            failed:
              failed.length,

            failures:
              failed,

            message:
              failed.length === 0
                ? "Stress-test bank transactions created successfully."
                : "Some Sandbox transactions could not be created.",

            next:
              "/relay/test-lab",
          },
          {
            headers:
              corsHeaders,
          }
        );


      } catch (error) {

        return Response.json(
          {
            success: false,

            message:
              error.message,

            plaid:
              error.plaid ||
              null,
          },
          {
            status:
              error.status ||
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }


    // ============================================================
    // CREATE SQUARE COLLISION ORDERS
    // ============================================================
    //
    // These orders are OPEN and UNPAID.
    //
    // They deliberately create purchase collisions.
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab/square-collisions" &&
      request.method ===
        "POST"
    ) {

      try {

        const JORDANS_VARIATION =
          "E6BJ6A3SPZR7R3QBBLU6VUJV";

        const SHIRT_VARIATION =
          "TRKPHURQAGALPGYHL3P42JY5";

        const LOCATION_ID =
          "L8REYQ315CEM6";


        const testOrders = [

          {
            label:
              "Jordans collision 1",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  JORDANS_VARIATION,
              },
            ],
          },

          {
            label:
              "Jordans collision 2",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  JORDANS_VARIATION,
              },
            ],
          },

          {
            label:
              "Jordans collision 3",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  JORDANS_VARIATION,
              },
            ],
          },

          {
            label:
              "Shirt collision 1",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  SHIRT_VARIATION,
              },
            ],
          },

          {
            label:
              "Shirt collision 2",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  SHIRT_VARIATION,
              },
            ],
          },

          {
            label:
              "Two-item basket",

            lineItems: [
              {
                quantity: "1",
                catalog_object_id:
                  JORDANS_VARIATION,
              },

              {
                quantity: "1",
                catalog_object_id:
                  SHIRT_VARIATION,
              },
            ],
          },
        ];


        const created = [];
        const failed = [];


        for (
          const testOrder
          of testOrders
        ) {

          try {

            const response =
              await fetch(
                "https://connect.squareupsandbox.com/v2/orders",
                {
                  method: "POST",

                  headers:
                    squareHeaders,

                  body:
                    JSON.stringify({
                      idempotency_key:
                        crypto.randomUUID(),

                      order: {
                        location_id:
                          LOCATION_ID,

                        reference_id:
                          `relay-test-${crypto.randomUUID()}`,

                        line_items:
                          testOrder.lineItems,
                      },
                    }),
                }
              );


            const data =
              await response.json();


            if (!response.ok) {

              failed.push({
                label:
                  testOrder.label,

                status:
                  response.status,

                details:
                  data,
              });

              continue;
            }


            created.push({
              label:
                testOrder.label,

              orderId:
                data.order?.id ||
                null,

              state:
                data.order?.state ||
                null,

              amount:
                data.order
                  ?.total_money
                  ?.amount
                  ? Number(
                      data.order
                        .total_money
                        .amount
                    ) / 100
                  : null,
            });


          } catch (error) {

            failed.push({
              label:
                testOrder.label,

              error:
                error.message,
            });
          }
        }


        return Response.json(
          {
            relayExperiment:
              "Relay Square Collision Generator v0.2",

            success:
              failed.length === 0,

            warning:
              "These are OPEN Sandbox orders, not paid purchases.",

            createdCount:
              created.length,

            failedCount:
              failed.length,

            created,

            failed,

            next:
              "/relay/test-lab",
          },
          {
            headers:
              corsHeaders,
          }
        );


      } catch (error) {

        return Response.json(
          {
            relayExperiment:
              "Relay Square Collision Generator v0.2",

            success: false,

            message:
              error.message,
          },
          {
            status: 500,

            headers:
              corsHeaders,
          }
        );
      }
    }
        // ============================================================
    // RELAY LIVE PURCHASE TEST + VERIFIED PURCHASE FEED
    // ============================================================
    // Sandbox only. No real money.
    // GET  /relay/live-test
    // POST /relay/live-test/pay
    // GET  /relay/verified-purchases
    // ============================================================

    const RELAY_SQUARE_APP_ID =
      "sandbox-sq0idb-S-JwqxshuoQuUVeJdZ6HBw";

    const RELAY_SQUARE_LOCATION_ID =
      "L8REYQ315CEM6";

    const RELAY_JORDANS_VARIATION_ID =
      "E6BJ6A3SPZR7R3QBBLU6VUJV";

    const RELAY_CONSUMER_APP =
      "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";


    function safeCardIdentityFromRequest() {

      const cookieCard =
        getRegisteredRelayCard();

      if (cookieCard) {
        return cookieCard;
      }

      const brand =
        normalizeCardBrand(
          url.searchParams.get("brand") || ""
        );

      const last4 =
        String(
          url.searchParams.get("last4") || ""
        ).trim();

      if (
        !brand ||
        !/^\d{4}$/.test(last4)
      ) {
        return null;
      }

      return {
        brand,
        last4,
        registeredAt: null,
      };
    }


    async function squareJson(
      path,
      options = {}
    ) {

      const response =
        await fetch(
          `https://connect.squareupsandbox.com${path}`,
          {
            ...options,

            headers: {
              ...squareHeaders,
              ...(options.headers || {}),
            },
          }
        );

      const data =
        await readJsonSafely(
          response
        );

      if (!response.ok) {

        const error =
          new Error(
            data?.errors?.[0]?.detail ||
            data?.errors?.[0]?.code ||
            `Square request failed with HTTP ${response.status}`
          );

        error.status =
          response.status;

        error.square =
          data;

        throw error;
      }

      return data;
    }


    async function relayOrderItems(
      order
    ) {

      const items = [];

      for (
        const item
        of order?.line_items || []
      ) {

        const catalog =
          await getCatalogData(
            item.catalog_object_id
          );

        items.push({

          name:
            item.name ||
            "Square item",

          variation:
            item.variation_name ||
            "",

          quantity:
            item.quantity ||
            "1",

          catalogObjectId:
            item.catalog_object_id ||
            null,

          parentItemId:
            catalog.parentItemId,

          sku:
            catalog.sku,

          imageUrl:
            catalog.imageUrl,

          price:
            item.base_price_money
              ? Number(
                  item.base_price_money.amount
                ) / 100
              : null,

          currency:
            item.base_price_money?.currency ||
            order?.total_money?.currency ||
            "GBP",
        });
      }

      return items;
    }


    // ============================================================
    // LIVE TEST PAGE
    // ============================================================

    if (
      url.pathname ===
        "/relay/live-test" &&
      request.method ===
        "GET"
    ) {

      const page = `<!doctype html>

<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
  Relay — Live Purchase Test
</title>

<script
  src="https://sandbox.web.squarecdn.com/v1/square.js">
</script>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f5f7fb;
  color: #101828;
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.wrap {
  max-width: 520px;
  margin: 45px auto;
  padding: 0 18px;
}

.brand {
  font-size: 23px;
  font-weight: 900;
  margin-bottom: 28px;
}

.badge {
  display: inline-block;
  background: #ecfdf3;
  color: #067647;
  border-radius: 99px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
}

.card {
  background: #fff;
  border: 1px solid #eaecf0;
  border-radius: 20px;
  padding: 20px;
  margin-top: 15px;
  box-shadow:
    0 4px 18px
    #1018280b;
}

.product {
  display: flex;
  gap: 15px;
  align-items: center;
}

.shoe {
  width: 78px;
  height: 78px;
  border-radius: 15px;
  background: #f2f4f7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38px;
}

.muted {
  color: #667085;
  font-size: 13px;
  line-height: 1.5;
}

.price {
  font-size: 29px;
  font-weight: 900;
  margin-top: 3px;
}

.btn {
  width: 100%;
  border: 0;
  border-radius: 13px;
  background: #101828;
  color: #fff;
  padding: 15px;
  font: inherit;
  font-weight: 850;
  cursor: pointer;
  margin-top: 14px;
}

.btn:disabled {
  opacity: .5;
  cursor: wait;
}

#card-container {
  margin-top: 16px;
  min-height: 90px;
}

.status {
  white-space: pre-wrap;
  background: #f2f4f7;
  border-radius: 13px;
  padding: 14px;
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.5;
}

.step {
  padding: 8px 0;
  border-bottom:
    1px solid #eaecf0;
  font-size: 13px;
}

.ok {
  color: #067647;
  font-weight: 800;
}

.err {
  color: #b42318;
  font-weight: 800;
}

.back {
  display: block;
  text-align: center;
  margin-top: 18px;
  color: #344054;
  font-weight: 700;
  text-decoration: none;
}

</style>

</head>

<body>

<div class="wrap">

<div class="brand">
  relay
  <span class="badge">
    SANDBOX LIVE TEST
  </span>
</div>

<div class="card">

<div class="product">

<div class="shoe">
  👟
</div>

<div>

<b>
  North & Co.
</b>

<div
  style="
    font-size:20px;
    font-weight:850;
    margin-top:3px
  "
>
  Relay Demo purchase
</div>

<div class="price">
  Select a product below
</div>

</div>

</div>

<p class="muted">
  This creates one genuine Square Sandbox
  card payment and one matching Plaid
  Sandbox bank transaction.
  No real money is used.
</p>

<label for="relay-product" style="display:block;margin-top:18px;font-weight:750">Choose a Square Sandbox product and size</label>
<select id="relay-product" style="width:100%;padding:12px;margin-top:8px;border:1px solid #d0d5dd;border-radius:10px">
<option value="">Loading Relay Demo catalogue…</option>
</select>
<p class="muted">Choose a Relay Demo variation for the next test purchase.</p>
<div id="card-container"></div>

<button
  class="btn"
  id="pay"
  disabled
>
  Buy selected Sandbox product
</button>

<div
  class="status"
  id="status"
>
  Loading Square secure card form…
</div>

</div>

<a
  class="back"
  href="${RELAY_CONSUMER_APP}"
>
  ← Back to Relay
</a>

</div>


<script>

const APP_ID =
  ${JSON.stringify(
    RELAY_SQUARE_APP_ID
  )};

const LOCATION_ID =
  ${JSON.stringify(
    RELAY_SQUARE_LOCATION_ID
  )};

const CONSUMER =
  ${JSON.stringify(
    RELAY_CONSUMER_APP
  )};

const statusBox =
  document.getElementById(
    "status"
  );

const payButton =
  document.getElementById(
    "pay"
  );

document.getElementById("relay-product").addEventListener("change",e=>{payButton.disabled=!e.target.value;const opt=e.target.selectedOptions[0];payButton.textContent=opt?.value?"Buy "+opt.textContent:"Select a product";});

let card;


function line(
  label,
  value,
  cls = ""
) {

  return (
    '<div class="step">' +
    '<span class="' +
    cls +
    '">' +
    label +
    '</span> ' +
    value +
    '</div>'
  );
}


async function boot() {

  try {

    if (!window.Square) {

      throw new Error(
        "Square Web Payments SDK did not load."
      );
    }

    const payments =
      window.Square.payments(
        APP_ID,
        LOCATION_ID
      );

    card =
      await payments.card();

    await card.attach(
      "#card-container"
    );

    payButton.disabled =
      !document.getElementById("relay-product")?.selectedOptions[0]?.value;

    statusBox.innerHTML =
      "Ready. Use a Square Sandbox test card — never a real card.";

  } catch (error) {

    statusBox.innerHTML =
      '<span class="err">' +
      "Could not initialise Square:" +
      "</span> " +
      error.message;
  }
}


payButton.onclick =
  async () => {

    payButton.disabled =
      true;

    const started =
      performance.now();

    statusBox.innerHTML =
      line(
        "1.",
        "Tokenising card securely with Square…"
      );

    try {

      const verificationDetails = {

        amount:
          document.getElementById("relay-product")?.selectedOptions[0]?.dataset.amount || "159.99",

        currencyCode:
          "GBP",

        intent:
          "CHARGE",

        customerInitiated:
          true,

        sellerKeyedIn:
          false,

        billingContact: {

          givenName:
            "Relay",

          familyName:
            "Sandbox",

          addressLines: [
            "1 Test Street",
          ],

          city:
            "London",

          state:
            "London",

          countryCode:
            "GB",

          postalCode:
            "SW1A 1AA",

          email:
            "sandbox@example.com",
        },
      };


      const tokenResult =
        await card.tokenize(
          verificationDetails
        );


      if (
        tokenResult.status !==
        "OK"
      ) {

        throw new Error(
          (
            tokenResult.errors ||
            []
          )
            .map(
              item =>
                item.message
            )
            .join("; ") ||
          "Square tokenisation failed."
        );
      }


      const tokenMs =
        Math.round(
          performance.now() -
          started
        );


      statusBox.innerHTML =
        line(
          "✓",
          "Square card token created in " +
          tokenMs +
          " ms",
          "ok"
        ) +
        line(
          "2.",
          "Creating paid Square order…"
        );


      const response =
        await fetch(
          "/relay/live-test/pay",
          {

            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                sourceId:
                  tokenResult.token,
                sku: document.getElementById("relay-product")?.value || "",
              }),
          }
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.success
      ) {

        throw new Error(
          data.message ||
          data.stage ||
          "Relay live test failed."
        );
      }


      const totalMs =
        Math.round(
          performance.now() -
          started
        );


      statusBox.innerHTML =

        line(
          "✓",
          "Square payment COMPLETED",
          "ok"
        ) +

        line(
          "✓",
          "Square order " +
          data.orderId.slice(
            0,
            10
          ) +
          "… linked",
          "ok"
        ) +

        line(
          "✓",
          "Card " +
          data.card.brand +
          " •••• " +
          data.card.last4 +
          " captured",
          "ok"
        ) +

        line(
          "✓",
          "Matching Plaid Sandbox transaction created",
          "ok"
        ) +

        line(
          "✓",
          "Relay verification bridge complete",
          "ok"
        ) +

        line(
          "Total:",
          totalMs +
          " ms from click to completed test",
          "ok"
        ) +

        '<div style="margin-top:12px">' +
        "Opening your Relay wallet…" +
        "</div>";


      const qs =
        new URLSearchParams({

          relayOrder:
            data.orderId,

          relayBrand:
            data.card.brand,

          relayLast4:
            data.card.last4,

          liveTest:
            "1",
        });


      setTimeout(
        () => {

          location.href =
            CONSUMER +
            "?" +
            qs.toString();

        },
        1800
      );


    } catch (error) {

      statusBox.innerHTML =
        '<span class="err">' +
        "Test failed:" +
        "</span> " +
        error.message;

      payButton.disabled =
        false;
    }
  };


fetch("/relay/live-test/products").then(r=>r.json()).then(data=>{
 const select=document.getElementById("relay-product");
 select.innerHTML="";
 for(const p of data.products||[]){
  const option=document.createElement("option");
  option.value=p.sku;
  option.dataset.amount=(Number(p.priceMinor||0)/100).toFixed(2);
  option.textContent=p.product+" / "+p.variation+" (GBP "+(Number(p.priceMinor||0)/100).toFixed(2)+")";
  select.appendChild(option);
 }
 select.dispatchEvent(new Event("change"));
 if(!select.options.length){select.innerHTML="<option value=\"\">Catalogue unavailable — do not pay</option>";payButton.disabled=true;}
}).catch(()=>{document.getElementById("relay-product").innerHTML="<option>Catalogue unavailable — do not pay</option>";payButton.disabled=true;});
boot();

</script>

</body>

</html>`;


      return new Response(
        page,
        {
          headers: {
            ...corsHeaders,

            "Content-Type":
              "text/html; charset=UTF-8",

            "Cache-Control":
              "no-store",
          },
        }
      );
    }


    // ============================================================
    // CREATE LIVE SQUARE PAYMENT + PLAID BRIDGE
    // ============================================================

    if (
      url.pathname ===
        "/relay/live-test/pay" &&
      request.method ===
        "POST"
    ) {

      const testStarted =
        Date.now();

      try {

        // This controlled Sandbox test creates a dedicated Plaid item
        // server-side. A browser cookie is not required for this route.
        // Both Plaid calls must succeed before charging the Square test card.
        const plaidPublicToken = await plaidPost(
          "/sandbox/public_token/create",
          {
            institution_id: "ins_109508",
            initial_products: ["transactions"],
          }
        );

        if (!plaidPublicToken?.public_token) {
          throw new Error(
            "Plaid Sandbox did not issue a public token. No Square payment was attempted."
          );
        }

        const plaidExchange = await plaidPost(
          "/item/public_token/exchange",
          { public_token: plaidPublicToken.public_token }
        );

        const accessToken = plaidExchange?.access_token;

        if (!accessToken) {
          throw new Error(
            "Plaid Sandbox token exchange failed. No Square payment was attempted."
          );
        }


        const body =
          await request.json();


        const sourceId =
          String(
            body?.sourceId ||
            ""
          ).trim();


        if (!sourceId) {

          return Response.json(
            {

              success:
                false,

              stage:
                "square_token",

              message:
                "Missing Square payment token.",
            },
            {
              status: 400,
              headers:
                corsHeaders,
            }
          );
        }


        // Optional exact Sandbox demo variation. The server resolves the SKU;
        // never accept an arbitrary Square catalogue ID from the browser.
        let checkoutVariationId = RELAY_JORDANS_VARIATION_ID;
        let checkoutLocationId = RELAY_SQUARE_LOCATION_ID;
        const selectedSku = String(body?.sku || "").trim();
        if (selectedSku) {
          if (!/^DEMO-[A-Z0-9-]{1,70}$/.test(selectedSku) || !env.RELAY_DB)
            throw Error("Invalid demo product SKU");
          const variant = await env.RELAY_DB.prepare(`SELECT v.external_variant_id AS id
            FROM retailer_catalog_variants v
            JOIN retailer_catalog_items i ON i.id=v.item_id
            WHERE i.provider='square_sandbox' AND v.sku=? LIMIT 1`)
            .bind(selectedSku).first();
          if (!variant?.id) throw Error("Demo variation not found in Square catalogue snapshot");
          checkoutVariationId = variant.id;
          const locationData = await squareJson("/v2/locations",{method:"GET"});
          const location = (locationData.locations||[]).find(l=>l.status==="ACTIVE");
          if (!location) throw Error("No active Square Sandbox location");
          checkoutLocationId = location.id;
        }

        // ========================================================
        // CREATE EXACT JORDANS ORDER
        // ========================================================

        const orderData =
          await squareJson(
            "/v2/orders",
            {

              method:
                "POST",

              body:
                JSON.stringify({

                  idempotency_key:
                    crypto.randomUUID(),

                  order: {

                    location_id:
                      checkoutLocationId,

                    reference_id:
                      "relay-live-" +
                      crypto
                        .randomUUID()
                        .slice(
                          0,
                          8
                        ),

                    line_items: [
                      {

                        quantity:
                          "1",

                        catalog_object_id:
                          checkoutVariationId,
                      },
                    ],
                  },
                }),
            }
          );


        const order =
          orderData.order;


        if (
          !order?.id ||
          !order?.total_money
            ?.amount
        ) {

          throw new Error(
            "Square created no usable demo order."
          );
        }


        // ========================================================
        // CREATE REAL SQUARE SANDBOX PAYMENT
        // ========================================================

        const paymentData =
          await squareJson(
            "/v2/payments",
            {

              method:
                "POST",

              body:
                JSON.stringify({

                  source_id:
                    sourceId,

                  idempotency_key:
                    crypto.randomUUID(),

                  amount_money: {

                    amount:
                      order
                        .total_money
                        .amount,

                    currency:
                      order
                        .total_money
                        .currency ||
                      "GBP",
                  },

                  order_id:
                    order.id,

                  location_id:
                    checkoutLocationId,

                  autocomplete:
                    true,

                  note:
                    "Relay Live Purchase Identity Test",
                }),
            }
          );


        const payment =
          paymentData.payment;


        const card =
          payment
            ?.card_details
            ?.card ||
          null;


        const brand =
          normalizeCardBrand(
            card?.card_brand ||
            ""
          );


        const last4 =
          String(
            card?.last_4 ||
            ""
          );


        if (
          !payment?.id ||
          !brand ||
          !/^\d{4}$/.test(
            last4
          )
        ) {

          throw new Error(
            "Square payment completed without usable card identity evidence."
          );
        }


        // ========================================================
        // CREATE CORRESPONDING PLAID SANDBOX SIGNAL
        // ========================================================

        let plaidCreated =
          null;


        try {

          const today =
            new Date()
              .toISOString()
              .slice(
                0,
                10
              );


          plaidCreated =
            await plaidPost(
              "/sandbox/transactions/create",
              {

                access_token:
                  accessToken,

                transactions: [
                  {

                    amount:
                      Number(
                        order
                          .total_money
                          .amount
                      ) / 100,

                    date_posted:
                      today,

                    date_transacted:
                      today,

                    description:
                      "NORTH & CO",

                    iso_currency_code:
                      order
                        .total_money
                        .currency ||
                      "GBP",
                  },
                ],
              }
            );


        } catch (
          plaidError
        ) {

          return Response.json(
            {

              success:
                false,

              stage:
                "plaid_bridge",

              message:
                plaidError.message,

              squarePaymentCompleted:
                true,

              orderId:
                order.id,

              paymentId:
                payment.id,
            },
            {

              status:
                plaidError.status ||
                500,

              headers:
                corsHeaders,
            }
          );
        }


        // ========================================================
        // REGISTER THE ACTUAL CARD IDENTITY RETURNED BY SQUARE
        // ========================================================

        const registered =
          encodeURIComponent(
            JSON.stringify({

              brand,

              last4,

              registeredAt:
                new Date()
                  .toISOString(),
            })
          );


        return Response.json(
          {

            success:
              true,

            sandbox:
              true,

            realMoney:
              false,

            orderId:
              order.id,

            paymentId:
              payment.id,

            paymentStatus:
              payment.status ||
              null,

            amount:
              Number(
                order
                  .total_money
                  .amount
              ) / 100,

            currency:
              order
                .total_money
                .currency ||
              "GBP",

            card: {
              brand,
              last4,
            },

            squareAuthorizedAt:
              payment
                ?.card_details
                ?.card_payment_timeline
                ?.authorized_at ||
              payment.created_at ||
              null,

            plaidTransactionCreated:
              Boolean(
                plaidCreated
              ),

            elapsedMs:
              Date.now() -
              testStarted,

            verificationMode:
              "controlled-sandbox-bridge",

            warning:
              "Square Sandbox and Plaid Sandbox are isolated systems. Relay created the corresponding Plaid Sandbox transaction after the Square Sandbox payment; this measures Relay orchestration, not real-bank feed latency.",
          },
          {

            headers: {

              ...corsHeaders,

              "Set-Cookie":
                `relay_registered_card=${registered}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
            },
          }
        );


      } catch (error) {

        return Response.json(
          {

            success:
              false,

            stage:
              "live_purchase",

            message:
              error.message,

            square:
              error.square ||
              null,
          },
          {

            status:
              error.status ||
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }


    // ============================================================
    // IDENTITY-GATED CONSUMER PURCHASE FEED
    // ============================================================

    if (
      url.pathname ===
        "/relay/verified-purchases" &&
      request.method ===
        "GET"
    ) {

      try {

        const identity =
          safeCardIdentityFromRequest();


        const requestedOrderId =
          String(
            url.searchParams.get(
              "orderId"
            ) ||
            ""
          ).trim();


        if (
          !identity ||
          !requestedOrderId
        ) {

          return Response.json(
            {

              success:
                true,

              verifiedPurchases:
                [],

              message:
                "No verified purchase identity supplied. Unverified Square orders remain hidden.",
            },
            {
              headers:
                corsHeaders,
            }
          );
        }


        const orderData =
          await squareJson(
            `/v2/orders/${encodeURIComponent(
              requestedOrderId
            )}`,
            {
              method:
                "GET",
            }
          );


        const order =
          orderData.order;


        if (
          !order ||
          order.location_id !==
            RELAY_SQUARE_LOCATION_ID
        ) {

          return Response.json(
            {

              success:
                true,

              verifiedPurchases:
                [],
            },
            {
              headers:
                corsHeaders,
            }
          );
        }


        const paymentsData =
          await squareJson(
            `/v2/payments?location_id=${encodeURIComponent(
              RELAY_SQUARE_LOCATION_ID
            )}&limit=100`,
            {
              method:
                "GET",
            }
          );


        const payment =
          (
            paymentsData.payments ||
            []
          ).find(
            payment =>
              payment.order_id ===
                order.id &&
              (
                payment.status ===
                  "COMPLETED" ||
                payment.status ===
                  "APPROVED"
              )
          );


        const squareCard =
          payment
            ?.card_details
            ?.card ||
          null;


        const cardMatches =
          Boolean(

            payment &&

            squareCard?.last_4 &&

            squareCard?.card_brand &&

            normalizeCardBrand(
              squareCard.card_brand
            ) ===
              normalizeCardBrand(
                identity.brand
              ) &&

            String(
              squareCard.last_4
            ) ===
              String(
                identity.last4
              )
          );


        if (!cardMatches) {

          return Response.json(
            {

              success:
                true,

              verifiedPurchases:
                [],

              message:
                "The requested Square order does not match this Relay payment identity.",
            },
            {
              headers:
                corsHeaders,
            }
          );
        }


        const items =
          await relayOrderItems(
            order
          );


        const total =
          order.total_money
            ? Number(
                order
                  .total_money
                  .amount
              ) / 100
            : null;


        return Response.json(
          {

            success:
              true,

            verifiedPurchases: [
              {

                orderId:
                  order.id,

                merchant:
                  "NORTH & CO.",

                createdAt:
                  order.created_at ||
                  null,

                authorizedAt:
                  payment
                    ?.card_details
                    ?.card_payment_timeline
                    ?.authorized_at ||
                  payment.created_at ||
                  null,

                total,

                currency:
                  order
                    .total_money
                    ?.currency ||
                  "GBP",

                matchStatus:
                  "MATCHED",

                verified:
                  true,

                confidence:
                  100,

                verificationSignals: [

                  "exact Square order from controlled Relay purchase flow",

                  "completed Square payment",

                  "Square card brand + last four match Relay payment identity",

                  "North & Co Square location",

                  "Plaid Sandbox transaction created during live test",
                ],

                items,
              },
            ],
          },
          {
            headers:
              corsHeaders,
          }
        );


      } catch (error) {

        return Response.json(
          {

            success:
              false,

            message:
              error.message,

            square:
              error.square ||
              null,
          },
          {

            status:
              error.status ||
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }
    // ============================================================
    // CREATE PAID SQUARE SANDBOX TEST
    // ============================================================
    //
    // Creates NEW Square orders and immediately pays them using
    // Square's official successful Sandbox card payment token.
    //
    // No real money.
    //
    // POST /relay/test-lab/paid-square-test
    // ============================================================

    if (
      url.pathname === "/relay/test-lab/paid-square-test" &&
      request.method === "POST"
    ) {

      try {

        const LOCATION_ID =
          "L8REYQ315CEM6";

        const JORDANS_VARIATION_ID =
          "E6BJ6A3SPZR7R3QBBLU6VUJV";

        const SHIRT_VARIATION_ID =
          "TRKPHURQAGALPGYHL3P42JY5";


        const scenarios = [

          {
            label:
              "Paid Jordans A",

            catalogObjectId:
              JORDANS_VARIATION_ID,
          },

          {
            label:
              "Paid Jordans B",

            catalogObjectId:
              JORDANS_VARIATION_ID,
          },

          {
            label:
              "Paid Jordans C",

            catalogObjectId:
              JORDANS_VARIATION_ID,
          },

          {
            label:
              "Paid Shirt A",

            catalogObjectId:
              SHIRT_VARIATION_ID,
          },

        ];


        const created = [];
        const failed = [];


        for (
          const scenario
          of scenarios
        ) {

          try {

            // ====================================================
            // 1. CREATE ORDER
            // ====================================================

            const orderResponse =
              await fetch(
                "https://connect.squareupsandbox.com/v2/orders",
                {
                  method: "POST",

                  headers:
                    squareHeaders,

                  body:
                    JSON.stringify({

                      idempotency_key:
                        crypto.randomUUID(),

                      order: {

                        location_id:
                          LOCATION_ID,

                        reference_id:
                        "relay-" +
                        crypto.randomUUID().slice(0, 8),

                        line_items: [
                          {
                            quantity:
                              "1",

                            catalog_object_id:
                              scenario
                                .catalogObjectId,
                          },
                        ],
                      },
                    }),
                }
              );


            const orderData =
              await orderResponse.json();


            if (
              !orderResponse.ok ||
              !orderData.order
            ) {

              failed.push({

                label:
                  scenario.label,

                stage:
                  "create_order",

                status:
                  orderResponse.status,

                details:
                  orderData,
              });

              continue;
            }


            const order =
              orderData.order;


            const amount =
              order.total_money
                ?.amount;


            const currency =
              order.total_money
                ?.currency ||
              "GBP";


            if (!amount) {

              failed.push({

                label:
                  scenario.label,

                stage:
                  "read_order_total",

                orderId:
                  order.id,

                details:
                  "Square order did not contain total_money.",
              });

              continue;
            }


            // ====================================================
            // 2. CREATE ACTUAL SANDBOX CARD PAYMENT
            // ====================================================

            const paymentResponse =
              await fetch(
                "https://connect.squareupsandbox.com/v2/payments",
                {
                  method: "POST",

                  headers:
                    squareHeaders,

                  body:
                    JSON.stringify({

                      source_id:
                        "cnon:card-nonce-ok",

                      idempotency_key:
                        crypto.randomUUID(),

                      amount_money: {

                        amount,

                        currency,
                      },

                      order_id:
                        order.id,

                      location_id:
                        LOCATION_ID,

                      autocomplete:
                        true,

                      note:
                        "Relay Purchase Identity Test Lab",
                    }),
                }
              );


            const paymentData =
              await paymentResponse.json();


            if (
              !paymentResponse.ok ||
              !paymentData.payment
            ) {

              failed.push({

                label:
                  scenario.label,

                stage:
                  "create_payment",

                orderId:
                  order.id,

                status:
                  paymentResponse.status,

                details:
                  paymentData,
              });

              continue;
            }


            const payment =
              paymentData.payment;


            const card =
              payment
                ?.card_details
                ?.card ||
              null;


            const timeline =
              payment
                ?.card_details
                ?.card_payment_timeline ||
              null;


            created.push({

              label:
                scenario.label,

              order: {

                id:
                  order.id,

                createdAt:
                  order.created_at ||
                  null,

                locationId:
                  order.location_id ||
                  null,

                amount:
                  Number(amount) / 100,

                currency,
              },

              payment: {

                id:
                  payment.id,

                status:
                  payment.status ||
                  null,

                orderId:
                  payment.order_id ||
                  null,

                locationId:
                  payment.location_id ||
                  null,

                createdAt:
                  payment.created_at ||
                  null,

                updatedAt:
                  payment.updated_at ||
                  null,

                amount:
                  payment
                    .amount_money
                    ?.amount
                    ? Number(
                        payment
                          .amount_money
                          .amount
                      ) / 100
                    : null,

                currency:
                  payment
                    .amount_money
                    ?.currency ||
                  null,

                sourceType:
                  payment.source_type ||
                  null,

                receiptNumber:
                  payment.receipt_number ||
                  null,

                receiptUrl:
                  payment.receipt_url ||
                  null,

                card: {

                  brand:
                    card
                      ?.card_brand ||
                    null,

                  last4:
                    card
                      ?.last_4 ||
                    null,

                  fingerprint:
                    card
                      ?.fingerprint ||
                    null,

                  cardType:
                    card
                      ?.card_type ||
                    null,

                  prepaidType:
                    card
                      ?.prepaid_type ||
                    null,

                  bin:
                    card
                      ?.bin ||
                    null,
                },

                cardDetails: {

                  status:
                    payment
                      ?.card_details
                      ?.status ||
                    null,

                  entryMethod:
                    payment
                      ?.card_details
                      ?.entry_method ||
                    null,

                  cvvStatus:
                    payment
                      ?.card_details
                      ?.cvv_status ||
                    null,

                  avsStatus:
                    payment
                      ?.card_details
                      ?.avs_status ||
                    null,

                  statementDescription:
                    payment
                      ?.card_details
                      ?.statement_description ||
                    null,

                  authorizedAt:
                    timeline
                      ?.authorized_at ||
                    null,

                  capturedAt:
                    timeline
                      ?.captured_at ||
                    null,
                },
              },
            });


          } catch (error) {

            failed.push({

              label:
                scenario.label,

              stage:
                "exception",

              error:
                error.message,
            });
          }
        }


        return Response.json(
          {

            relayExperiment:
              "Relay Paid Square Identity Test v0.1",

            success:
              failed.length === 0,

            sandbox:
              true,

            realMoney:
              false,

            requested:
              scenarios.length,

            created:
              created.length,

            failed:
              failed.length,

            results:
              created,

            failures:
              failed,

            explanation:
              "These are genuine Square Sandbox Payment objects attached to genuine Square Sandbox Orders. The generic Square Sandbox card token is used, so this stage inspects payment metadata rather than pretending to represent several different consumer cards.",

            next:
              "/relay/test-lab/run",
          },

          {
            headers:
              corsHeaders,
          }
        );


      } catch (error) {

        return Response.json(
          {

            relayExperiment:
              "Relay Paid Square Identity Test v0.1",

            success:
              false,

            message:
              error.message,
          },

          {
            status:
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }

    // ============================================================
    // TEST LAB MATCHING ENGINE
    // ============================================================

    if (
      url.pathname ===
        "/relay/test-lab/run" &&
      request.method ===
        "GET"
    ) {

      try {

        const accessToken =
          getPlaidAccessTokenFromCookie();


        if (!accessToken) {

          return Response.json(
            {
              success: false,

              message:
                "Connect the UK Plaid Sandbox bank first.",

              next:
                "/plaid/connect?user=relay_user_001",
            },
            {
              status: 401,

              headers:
                corsHeaders,
            }
          );
        }


        const registeredCard =
          getRegisteredRelayCard();


        // ========================================================
        // PLAID TRANSACTIONS
        // ========================================================

        const end =
          new Date();

        const start =
          new Date(end);

        start.setDate(
          start.getDate() - 90
        );


        const dateOnly =
          (date) =>
            date
              .toISOString()
              .slice(0, 10);


        const plaidData =
          await plaidPost(
            "/transactions/get",
            {
              access_token:
                accessToken,

              start_date:
                dateOnly(start),

              end_date:
                dateOnly(end),

              options: {
                count: 500,
                offset: 0,
                include_original_description:
                  true,
              },
            }
          );


        // ========================================================
        // SQUARE ORDERS
        // ========================================================

        const squareResponse =
          await fetch(
            "https://connect.squareupsandbox.com/v2/orders/search",
            {
              method: "POST",

              headers:
                squareHeaders,

              body:
                JSON.stringify({
                  location_ids: [
                    "L8REYQ315CEM6",
                  ],

                  query: {
                    sort: {
                      sort_field:
                        "CREATED_AT",

                      sort_order:
                        "DESC",
                    },
                  },

                  limit: 100,

                  return_entries:
                    false,
                }),
            }
          );


        const squareData =
          await squareResponse.json();


        if (!squareResponse.ok) {

          return Response.json(
            {
              success: false,

              stage:
                "square_orders",

              details:
                squareData,
            },
            {
              status:
                squareResponse.status,

              headers:
                corsHeaders,
            }
          );
        }


        const transactions =
          plaidData.transactions ||
          [];

        const orders =
          squareData.orders ||
          [];


        // ========================================================
        // SQUARE PAYMENTS
        // ========================================================

        const squarePaymentsResponse =
          await fetch(
            "https://connect.squareupsandbox.com/v2/payments?location_id=L8REYQ315CEM6&limit=100",
            {
              method: "GET",

              headers:
                squareHeaders,
            }
          );


        const squarePaymentsData =
          await squarePaymentsResponse
            .json();


        if (!squarePaymentsResponse.ok) {

          return Response.json(
            {
              success: false,

              stage:
                "square_payments",

              details:
                squarePaymentsData,
            },
            {
              status:
                squarePaymentsResponse.status,

              headers:
                corsHeaders,
            }
          );
        }


        const squarePayments =
          squarePaymentsData.payments ||
          [];


        const paymentByOrderId =
          new Map();


        for (
          const payment
          of squarePayments
        ) {

          if (payment.order_id) {

            paymentByOrderId.set(
              payment.order_id,
              payment
            );
          }
        }


        // ========================================================
        // MATCHING ENGINE
        // ========================================================

        const results = [];


        for (
          const transaction
          of transactions
        ) {

          const bankAmount =
            Math.abs(
              Number(
                transaction.amount
              )
            );


          const merchantText =
            [
              transaction.name,
              transaction.merchant_name,
              transaction.original_description,
            ]
              .filter(Boolean)
              .join(" ")
              .toUpperCase();


          const candidates = [];


          for (
            const order
            of orders
          ) {

            if (!order.total_money) {
              continue;
            }


            const orderAmount =
              Number(
                order.total_money.amount
              ) / 100;


            const amountDifference =
              Math.abs(
                bankAmount -
                orderAmount
              );


            let score = 0;

            const reasons = [];


            // ====================================================
            // AMOUNT
            // ====================================================

            if (
              amountDifference < 0.01
            ) {

              score += 35;

              reasons.push(
                "Exact amount"
              );


            } else if (
              amountDifference <= 0.02
            ) {

              score += 10;

              reasons.push(
                "Near amount"
              );


            } else {

              continue;
            }


            // ====================================================
            // MERCHANT
            // ====================================================

            const looksLikeNorthCo =
              merchantText.includes(
                "NORTH"
              );


            if (looksLikeNorthCo) {

              score += 25;

              reasons.push(
                "Merchant resembles North & Co"
              );


            } else {

              reasons.push(
                "Merchant does not match"
              );
            }


            // ====================================================
            // SQUARE PAYMENT EVIDENCE
            // ====================================================

            const squarePayment =
              paymentByOrderId.get(
                order.id
              ) ||
              null;


            const squareCard =
              squarePayment
                ?.card_details
                ?.card ||
              null;


            const squareAuthorizationTime =
              squarePayment
                ?.card_details
                ?.card_payment_timeline
                ?.authorized_at ||
              squarePayment
                ?.created_at ||
              null;


            // ====================================================
            // PLAID AUTHORISATION EVIDENCE
            // ====================================================

            const plaidAuthorizationTime =
              transaction
                .authorized_datetime ||
              transaction.datetime ||
              null;


            const plaidAuthorizationDate =
              transaction
                .authorized_date ||
              transaction.date ||
              null;


            // ====================================================
            // TIME
            // ====================================================

            let dayDifference =
              null;

            let minuteDifference =
              null;


            if (
              plaidAuthorizationTime &&
              squareAuthorizationTime
            ) {

              const plaidTime =
                new Date(
                  plaidAuthorizationTime
                );

              const squareTime =
                new Date(
                  squareAuthorizationTime
                );


              if (
                !Number.isNaN(
                  plaidTime.getTime()
                ) &&
                !Number.isNaN(
                  squareTime.getTime()
                )
              ) {

                minuteDifference =
                  Math.abs(
                    plaidTime -
                    squareTime
                  ) /
                  (
                    1000 *
                    60
                  );


                if (
                  minuteDifference <= 2
                ) {

                  score += 20;

                  reasons.push(
                    "Payment times within 2 minutes"
                  );


                } else if (
                  minuteDifference <= 10
                ) {

                  score += 15;

                  reasons.push(
                    "Payment times within 10 minutes"
                  );


                } else if (
                  minuteDifference <= 60
                ) {

                  score += 8;

                  reasons.push(
                    "Payment times within 1 hour"
                  );


                } else {

                  reasons.push(
                    "Payment times too far apart"
                  );
                }
              }


            } else if (
              plaidAuthorizationDate &&
              order.created_at
            ) {

              const bankDate =
                new Date(
                  plaidAuthorizationDate +
                  "T12:00:00Z"
                );

              const orderDate =
                new Date(
                  order.created_at
                );


              if (
                !Number.isNaN(
                  bankDate.getTime()
                ) &&
                !Number.isNaN(
                  orderDate.getTime()
                )
              ) {

                dayDifference =
                  Math.abs(
                    bankDate -
                    orderDate
                  ) /
                  (
                    1000 *
                    60 *
                    60 *
                    24
                  );


                if (
                  dayDifference <= 1
                ) {

                  score += 15;

                  reasons.push(
                    "Authorization date within 1 day"
                  );


                } else if (
                  dayDifference <= 3
                ) {

                  score += 8;

                  reasons.push(
                    "Authorization date within 3 days"
                  );


                } else if (
                  dayDifference <= 7
                ) {

                  score += 3;

                  reasons.push(
                    "Authorization date within 7 days"
                  );


                } else {

                  reasons.push(
                    "Authorization date too far apart"
                  );
                }
              }
            }


            // ====================================================
            // RETAILER LOCATION
            // ====================================================

            const expectedLocationId =
              "L8REYQ315CEM6";


            const locationMatches =
              order.location_id ===
              expectedLocationId;


            if (locationMatches) {

              score += 5;

              reasons.push(
                "Square retailer location matches North & Co"
              );
            }


            // ====================================================
            // REGISTERED CARD IDENTITY
            // ====================================================

            let registeredCardMatch =
              null;


            if (
              registeredCard &&
              squareCard?.last_4 &&
              squareCard?.card_brand
            ) {

              const squareBrand =
                normalizeCardBrand(
                  squareCard.card_brand
                );


              const relayBrand =
                normalizeCardBrand(
                  registeredCard.brand
                );


              const brandMatches =
                squareBrand ===
                relayBrand;


              const last4Matches =
                String(
                  squareCard.last_4
                ) ===
                String(
                  registeredCard.last4
                );


              registeredCardMatch =
                brandMatches &&
                last4Matches;


              if (
                registeredCardMatch
              ) {

                score += 30;

                reasons.push(
                  "Square payment matches Relay registered card brand + last four"
                );


              } else {

                score -= 35;

                reasons.push(
                  "Square payment card conflicts with Relay registered card"
                );
              }


            } else if (
              registeredCard &&
              !squarePayment
            ) {

              reasons.push(
                "Relay card registered but this Square order has no payment evidence"
              );
            }


            // ====================================================
            // PAID / PAYMENT SIGNAL
            // ====================================================

            if (squarePayment) {

              score += 5;

              reasons.push(
                "Square payment attached to order"
              );


              if (
                squarePayment.status ===
                  "COMPLETED" ||
                squarePayment.status ===
                  "APPROVED"
              ) {

                score += 5;

                reasons.push(
                  `Square payment status ${squarePayment.status}`
                );
              }
            }


            // ====================================================
            // ITEM NAMES
            // ====================================================

            const itemNames =
              (
                order.line_items ||
                []
              )
                .map(
                  item =>
                    item.name ||
                    "Square item"
                );


            score =
              Math.max(
                0,
                Math.min(
                  score,
                  100
                )
              );


            candidates.push({

              orderId:
                order.id,

              amount:
                orderAmount,

              score,

              reasons,

              registeredCardMatch,

              dayDifference:
                dayDifference === null
                  ? null
                  : Number(
                      dayDifference
                        .toFixed(2)
                    ),

              minuteDifference:
                minuteDifference === null
                  ? null
                  : Number(
                      minuteDifference
                        .toFixed(2)
                    ),

              itemNames,

              square: {

                orderId:
                  order.id,

                orderCreatedAt:
                  order.created_at ||
                  null,

                locationId:
                  order.location_id ||
                  null,

                locationMatches,

                paymentFound:
                  Boolean(
                    squarePayment
                  ),

                paymentId:
                  squarePayment?.id ||
                  null,

                paymentStatus:
                  squarePayment?.status ||
                  null,

                paymentCreatedAt:
                  squarePayment
                    ?.created_at ||
                  null,

                paymentAuthorizedAt:
                  squareAuthorizationTime,

                sourceType:
                  squarePayment
                    ?.source_type ||
                  null,

                cardBrand:
                  squareCard
                    ?.card_brand ||
                  null,

                cardLast4:
                  squareCard
                    ?.last_4 ||
                  null,

                cardFingerprint:
                  squareCard
                    ?.fingerprint ||
                  null,

                cardType:
                  squareCard
                    ?.card_type ||
                  null,

                entryMethod:
                  squarePayment
                    ?.card_details
                    ?.entry_method ||
                  null,

                statementDescription:
                  squarePayment
                    ?.card_details
                    ?.statement_description ||
                  null,

                receiptNumber:
                  squarePayment
                    ?.receipt_number ||
                  null,
              },

              plaid: {

                transactionId:
                  transaction
                    .transaction_id ||
                  null,

                accountId:
                  transaction
                    .account_id ||
                  null,

                merchantName:
                  transaction
                    .merchant_name ||
                  null,

                name:
                  transaction.name ||
                  null,

                originalDescription:
                  transaction
                    .original_description ||
                  null,

                authorizedDate:
                  transaction
                    .authorized_date ||
                  null,

                authorizedDatetime:
                  transaction
                    .authorized_datetime ||
                  null,

                postedDate:
                  transaction.date ||
                  null,

                postedDatetime:
                  transaction.datetime ||
                  null,

                pending:
                  transaction.pending,

                paymentChannel:
                  transaction
                    .payment_channel ||
                  null,

                website:
                  transaction.website ||
                  null,

                merchantEntityId:
                  transaction
                    .merchant_entity_id ||
                  null,

                referenceNumber:
                  transaction
                    .payment_meta
                    ?.reference_number ||
                  null,

                location: {

                  address:
                    transaction.location
                      ?.address ||
                    null,

                  city:
                    transaction.location
                      ?.city ||
                    null,

                  region:
                    transaction.location
                      ?.region ||
                    null,

                  postalCode:
                    transaction.location
                      ?.postal_code ||
                    null,

                  country:
                    transaction.location
                      ?.country ||
                    null,

                  storeNumber:
                    transaction.location
                      ?.store_number ||
                    null,

                  lat:
                    transaction.location
                      ?.lat ??
                    null,

                  lon:
                    transaction.location
                      ?.lon ??
                    null,
                },
              },
            });

          } // closes order loop


          candidates.sort(
            (a, b) =>
              b.score -
              a.score
          );


          // ======================================================
          // DECISION ENGINE
          // ======================================================

          let status =
            "REJECTED";

          let decision =
            "No sufficiently strong Square order candidate.";


          const best =
            candidates[0] ||
            null;

          const second =
            candidates[1] ||
            null;


          if (best) {

            if (
              best.score >= 85
            ) {

              if (
                second &&
                second.score >=
                  best.score - 5
              ) {

                status =
                  "AMBIGUOUS";

                decision =
                  "Multiple Square orders are equally plausible. Relay refuses to auto-assign.";


              } else {

                status =
                  "MATCHED";

                decision =
                  best.registeredCardMatch === true
                    ? "One Square order is materially stronger and its payment card matches the card registered with Relay."
                    : "One Square order is materially stronger than the alternatives.";
              }


            } else if (
              best.score >= 60
            ) {

              status =
                "AMBIGUOUS";

              decision =
                "Possible purchase, but evidence is not strong enough for automatic assignment.";


            } else {

              status =
                "REJECTED";

              decision =
                "Candidate is too weak to associate with this Relay user.";
            }
          }


          results.push({

            status,

            decision,

            bank: {

              transactionId:
                transaction
                  .transaction_id,

              name:
                transaction.name ||
                transaction
                  .merchant_name ||
                "Unknown transaction",

              merchant:
                transaction
                  .merchant_name ||
                null,

              amount:
                bankAmount,

              date:
                transaction.date,

              authorizedDate:
                transaction
                  .authorized_date ||
                null,

              authorizedDatetime:
                transaction
                  .authorized_datetime ||
                null,

              currency:
                transaction
                  .iso_currency_code ||
                null,
            },

            candidates:
              candidates.slice(
                0,
                5
              ),
          });
        }


        // ========================================================
        // SORT RESULTS
        // ========================================================

        const priority = {
          AMBIGUOUS: 1,
          MATCHED: 2,
          REJECTED: 3,
        };


        results.sort(
          (a, b) => {

            if (
              priority[a.status] !==
              priority[b.status]
            ) {

              return (
                priority[a.status] -
                priority[b.status]
              );
            }


            return (
              b.bank.amount -
              a.bank.amount
            );
          }
        );


        // ========================================================
        // SUMMARY
        // ========================================================

        const summary = {

          matched:
            results.filter(
              result =>
                result.status ===
                "MATCHED"
            ).length,

          ambiguous:
            results.filter(
              result =>
                result.status ===
                "AMBIGUOUS"
            ).length,

          rejected:
            results.filter(
              result =>
                result.status ===
                "REJECTED"
            ).length,
        };


        return Response.json(
          {
            relayExperiment:
              "Relay Purchase Identity Engine Stress Test v0.2",

            success: true,

            registeredRelayCard:
              registeredCard
                ? {
                    brand:
                      registeredCard.brand,

                    last4:
                      registeredCard.last4,
                  }
                : null,

            transactionCount:
              transactions.length,

            squareOrderCount:
              orders.length,

            squarePaymentCount:
              squarePayments.length,

            summary,

            signals: [
              "amount",
              "merchant",
              "authorization time/date",
              "Square location",
              "Square payment presence",
              "Relay registered card brand + last four",
            ],

            interpretation: {

              matched:
                "Relay found one materially stronger Square candidate.",

              ambiguous:
                "Relay found plausible purchase candidates but will not guess.",

              rejected:
                "Relay found insufficient evidence of a corresponding Square purchase.",
            },

            warning:
              "Experimental Sandbox matching only. Brand + last four is an additional identity signal, not a globally unique card identifier.",

            results,
          },
          {
            headers:
              corsHeaders,
          }
        );


      } catch (error) {

        return Response.json(
          {
            relayExperiment:
              "Relay Purchase Identity Engine Stress Test v0.2",

            success: false,

            message:
              error.message,

            plaid:
              error.plaid ||
              null,
          },
          {
            status:
              error.status ||
              500,

            headers:
              corsHeaders,
          }
        );
      }
    }  // ============================================================
    // 404
    // ============================================================

    return Response.json(
      {
        error:
          "Not found",

        availableRoutes: [
          "/",
          "/purchases",
          "/order/:orderId",
          "/plaid/connect?user=relay_user_001",
          "/plaid/transactions",
          "/plaid/sandbox-transaction",
          "/relay/match-test",
          "/relay/test-lab",
          "/relay/test-lab/setup",
          "/relay/test-lab/run",
          "/relay/test-lab/square-collisions",
          "/relay/test-lab/paid-square-test",
        ],
      },

      {
        status: 404,

        headers:
          corsHeaders,
      }
    );
  },
};