import { createClient } from "jsr:@supabase/supabase-js@2";
import { createGuestToken, guestTokenDigest } from "../_shared/guest-token.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({error:"method_not_allowed"}, 405);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({error:"invalid_request"}, 400); }
  if (!body || ["court_id", "starts_at", "ends_at", "request_key", "name", "phone", "email", "captcha"].some((key) => typeof body[key] !== "string" || !(body[key] as string).trim() || (body[key] as string).length > 2048)) return json({error:"invalid_request"}, 400);
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY"), url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !key) return json({error:"service_unavailable"}, 503);
  try {
    const form = new URLSearchParams({secret, response:body.captcha as string});
    const verified = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {method:"POST", body:form});
    const check = await verified.json();
    if (!verified.ok || check.success !== true) return json({error:"verification_failed"}, 400);
    const db = createClient(url, key, {auth:{persistSession:false}});
    const email = (body.email as string).trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    const subject = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2,"0")).join("");
    const rate = await db.rpc("claim_guest_booking_attempt", {p_subject_hash:subject});
    if (rate.error) throw rate.error;
    if (!rate.data) return json({error:"rate_limited"}, 429);
    // The caller supplies a token on retry so idempotency cannot disclose another guest's booking.
    const token = typeof body.access_token === "string" ? body.access_token : createGuestToken();
    const tokenHash = await guestTokenDigest(token);
    const expiry = new Date(Math.max(Date.now() + 30 * 86400000, Date.parse(body.ends_at as string) + 7 * 86400000));
    if (!Number.isFinite(expiry.getTime())) return json({error:"invalid_request"}, 400);
    const result = await db.rpc("create_guest_booking", {p_court_id:body.court_id, p_starts_at:body.starts_at, p_ends_at:body.ends_at, p_idempotency_key:body.request_key, p_guest_name:body.name, p_guest_phone:body.phone, p_guest_email:email, p_token_hash:tokenHash, p_token_expires_at:expiry.toISOString()});
    if (result.error) return json({error:"reservation_unavailable"}, 409);
    return json({token, booking_id:result.data.id});
  } catch { return json({error:"service_unavailable"}, 503); }
});
