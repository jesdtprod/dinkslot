import { createClient } from "jsr:@supabase/supabase-js@2";
import { issueGuestBookingToken } from "../_shared/guest-access.ts";
import { getMailer } from "../_shared/gmail-mailer.ts";
import { guestRecoveryEmail } from "../send-booking-email/lib.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const generic={ok:true,message:"If there are eligible guest bookings, a link will be sent to that email."};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  let body:{email?:unknown,captcha?:unknown}; try{body=await req.json();}catch{return json({error:"invalid_request"},400);}
  if(typeof body?.email!=="string" || body.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || typeof body.captcha!=="string" || !body.captcha || body.captcha.length>2048) return json({error:"invalid_request"},400);
  const secret=Deno.env.get("TURNSTILE_SECRET_KEY"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!secret||!url||!key) return json({error:"service_unavailable"},503);
  try {
    const verified=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:new URLSearchParams({secret,response:body.captcha})});
    if(!verified.ok || (await verified.json()).success!==true) return json({error:"verification_failed"},400);
    const db=createClient(url,key,{auth:{persistSession:false}}),email=body.email.trim().toLowerCase();
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("guest-recovery:"+email));
    const subject=Array.from(new Uint8Array(hash),(b)=>b.toString(16).padStart(2,"0")).join("");
    const limit=await db.rpc("claim_guest_booking_attempt",{p_subject_hash:subject});
    if(limit.error || !limit.data) return json(generic);
    const mailer=getMailer(); if(!mailer) return json(generic);
    const contacts=await db.from("guest_booking_contacts").select("booking_id").eq("email",email).limit(50);
    if(contacts.error || !contacts.data?.length) return json(generic);
    const ids=contacts.data.map((c:{booking_id:string})=>c.booking_id);
    const bookings=await db.from("bookings").select("id,tenant_id,reference_code,ends_at").in("id",ids).eq("source","guest_online").is("deleted_at",null).order("starts_at",{ascending:false}).limit(10);
    if(bookings.error || !bookings.data?.length) return json(generic);
    const tenantIds=Array.from(new Set(bookings.data.map((booking:{tenant_id:string})=>booking.tenant_id)));
    const tenants=await db.from("tenants").select("id,name").in("id",tenantIds);
    if(tenants.error) return json(generic);
    const tenantNames=new Map((tenants.data || []).map((tenant:{id:string,name:string})=>[tenant.id,tenant.name]));
    const site=Deno.env.get("SITE_URL") ?? "https://jesdtprod.github.io/dinkslot/";
    const links:{ref:string,url:string,club:string}[]=[];
    for(const booking of bookings.data){
      const expiry=new Date(Math.max(Date.now()+30*86400000,Date.parse(booking.ends_at)+7*86400000));
      const token=await issueGuestBookingToken(db,booking.id,expiry);
      links.push({ref:booking.reference_code,club:tenantNames.get(booking.tenant_id) || "Club",url:site.replace(/\/?$/, "/")+"#/guest/booking?token="+encodeURIComponent(token)});
    }
    const {text,html}=guestRecoveryEmail(links, {logoUrl:site.replace(/\/?$/, "/") + "assets/dinkslot-logo.png",email:mailer.fromEmail,address:Deno.env.get("DINKSLOT_ADDRESS"),phone:Deno.env.get("DINKSLOT_CONTACT_PHONE")});
    await mailer.send({fromName:"DINKSLOT",fromEmail:mailer.fromEmail,to:email,subject:"Your DINKSLOT guest booking links",text,html});
  } catch { console.error("Guest booking recovery unavailable"); }
  return json(generic);
});
