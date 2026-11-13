import { createClient } from "jsr:@supabase/supabase-js@2";
import { guestTokenDigest } from "../_shared/guest-token.ts";
const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS", "Cache-Control":"no-store"};
function json(body: unknown, status=200) { return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}}); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  if (req.method !== "POST") return json({error:"method_not_allowed"},405);
  let data: {token?:unknown}; try { data=await req.json(); } catch { return json({error:"invalid_request"},400); }
  if (typeof data?.token !== "string" || !/^[0-9a-f]{64}$/.test(data.token)) return json({error:"invalid_or_expired_link"},401);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({error:"service_unavailable"},503);
  try {
    const db=createClient(url,key,{auth:{persistSession:false}});
    const result=await db.rpc("release_guest_booking",{p_token_hash:await guestTokenDigest(data.token)});
    if (result.error) return json({error:"unable_to_release"},409);
    return json({ok:true});
  } catch { return json({error:"service_unavailable"},503); }
});
