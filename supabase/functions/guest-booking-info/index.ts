import { createClient } from "jsr:@supabase/supabase-js@2";
import { guestTokenDigest } from "../_shared/guest-token.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  let body:{court_id?:unknown,token?:unknown}; try{body=await req.json();}catch{return json({error:"invalid_request"},400);}
  if(typeof body?.court_id!=="string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.court_id) || (body.token!=null && (typeof body.token!=="string" || !/^[0-9a-f]{64}$/.test(body.token)))) return json({error:"invalid_request"},400);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if(!url||!key) return json({error:"service_unavailable"},503);
  try {
    const db=createClient(url,key,{auth:{persistSession:false}}), hash=typeof body.token==="string" ? await guestTokenDigest(body.token) : null;
    const result=await db.rpc("get_guest_booking_info",{p_court_id:body.court_id,p_token_hash:hash});
    if(result.error || !result.data) return json({error:"unavailable"},404);
    if(hash && Array.isArray(result.data.qrs)) {
      for(const qr of result.data.qrs){ if(qr.qr_path){ const signed=await db.storage.from("payment").createSignedUrl(qr.qr_path,600); if(signed.error) return json({error:"service_unavailable"},503); qr.signed_url=signed.data.signedUrl; } }
    }
    return json(result.data);
  } catch {return json({error:"service_unavailable"},503);}
});
