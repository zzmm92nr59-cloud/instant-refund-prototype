import { syncSquareCatalogue } from "./square-catalogue.js";

const ENDPOINT = "https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/square";
const TYPES = new Set(["inventory.count.updated", "catalog.version.updated"]);

export async function receiveSquareWebhook(request, env, ctx) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !env.RELAY_DB || !env.SQUARE_ACCESS_TOKEN)
    return Response.json({error:"Webhook not configured"},{status:503});
  const raw = await request.text();
  if (raw.length > 262144) return new Response("Payload too large",{status:413});
  const header = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!header) return new Response("Forbidden",{status:403});
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    {name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(ENDPOINT+raw));
  const actual = Uint8Array.from(atob(header),c=>c.charCodeAt(0));
  const expected = new Uint8Array(signature);
  let diff=actual.length===expected.length?0:1;
  for(let i=0;i<expected.length;i++)diff |= expected[i] ^ (actual[i]||0);
  if(diff!==0) return new Response("Forbidden",{status:403});
  let event;
  try { event=JSON.parse(raw); } catch { return new Response("Invalid JSON",{status:400}); }
  if(!event.event_id || !TYPES.has(event.type))
    return Response.json({received:true,ignored:true});
  // Acknowledge promptly. Re-fetch authoritative current stock rather than trust
  // potentially reordered inventory webhook payloads.
  ctx.waitUntil((async()=>{
    try {
      const result=await syncSquareCatalogue(env);
      await env.RELAY_DB.prepare(`INSERT INTO audit_events
        (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json)
        VALUES (?,?,?,?,?,?,?)`)
        .bind("square:webhook:"+event.event_id,"system","square_webhook","webhook_processed",
          "retailer_connection","square:sandbox",JSON.stringify({type:event.type,...result})).run();
    } catch(error) {
      // Duplicate event audit IDs are harmless. Other failures must be visible in logs.
      if(!String(error?.message||"").includes("UNIQUE constraint failed"))
        console.error("Square webhook sync failed",event.event_id,String(error));
    }
  })());
  return Response.json({received:true});
}
