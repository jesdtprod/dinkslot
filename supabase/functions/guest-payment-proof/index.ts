import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveGuestBooking } from "../_shared/guest-access.ts";
import { guestTokenDigest } from "../_shared/guest-token.ts";
const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods":"POST, OPTIONS", "Cache-Control":"no-store"};
function json(body: unknown, status=200) { return new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json"}}); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  if (req.method !== "POST") return json({error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({error:"service_unavailable"},503);
  let data: FormData;
  try { data=await req.formData(); } catch { return json({error:"invalid_request"},400); }
  const token=data.get("token"), idempotency=data.get("idempotency_key"), method=data.get("method"), file=data.get("file");
  if (typeof token!=="string" || typeof idempotency!=="string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotency) || typeof method!=="string" || method.length>40 || !(file instanceof File) || file.size===0 || file.size>5*1024*1024) return json({error:"invalid_request"},400);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const jpeg=bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  const png=bytes.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const webp=bytes.length>=12 && new TextDecoder().decode(bytes.slice(0,4))==="RIFF" && new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
  const kind=jpeg?{type:"image/jpeg",ext:"jpg"}:png?{type:"image/png",ext:"png"}:webp?{type:"image/webp",ext:"webp"}:null;
  if (!kind || file.type!==kind.type) return json({error:"invalid_image"},400);
  const db=createClient(url,key,{auth:{persistSession:false}});
  let path: string | null=null;
  try {
    const bookingId=await resolveGuestBooking(db,token);
    if (!bookingId) return json({error:"invalid_or_expired_link"},401);
    const booking=await db.from("bookings").select("tenant_id").eq("id",bookingId).eq("source","guest_online").is("deleted_at",null).maybeSingle();
    if (booking.error) throw booking.error;
    if (!booking.data) return json({error:"invalid_or_expired_link"},401);
    path=booking.data.tenant_id+"/guest-proofs/"+bookingId+"/"+crypto.randomUUID()+"."+kind.ext;
    const upload=await db.storage.from("payment").upload(path,bytes,{contentType:kind.type,upsert:false});
    if (upload.error) throw upload.error;
    const result=await db.rpc("attach_guest_payment_proof",{p_token_hash:await guestTokenDigest(token),p_proof_path:path,p_idempotency_key:idempotency,p_method:method});
    if (result.error) { await db.storage.from("payment").remove([path]); return json({error:"payment_not_submitted"},409); }
    const saved=await db.from("booking_payments").select("proof_path").eq("id",result.data).maybeSingle();
    if (!saved.error && saved.data && saved.data.proof_path!==path) await db.storage.from("payment").remove([path]);
    return json({ok:true});
  } catch { if (path) await db.storage.from("payment").remove([path]); return json({error:"service_unavailable"},503); }
});
