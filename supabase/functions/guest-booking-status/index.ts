import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveGuestBooking } from "../_shared/guest-access.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { token?: unknown };
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (typeof body?.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token)) return json({ error: "invalid_or_expired_link" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "service_unavailable" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const bookingId = await resolveGuestBooking(db, body.token);
    if (!bookingId) return json({ error: "invalid_or_expired_link" }, 401);
    const { data: booking, error } = await db.from("bookings")
      .select("tenant_id,court_id,guest_name,starts_at,ends_at,amount,status,reference_code,expires_at,reject_reason,cancel_reason")
      .eq("id", bookingId).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    if (!booking) return json({ error: "invalid_or_expired_link" }, 401);
    const [club, court, payment] = await Promise.all([
      db.from("tenants").select("name,slug,timezone").eq("id", booking.tenant_id).maybeSingle(),
      db.from("courts").select("name,surface").eq("id", booking.court_id).eq("tenant_id", booking.tenant_id).maybeSingle(),
      db.from("booking_payments").select("id").eq("booking_id", bookingId).is("deleted_at", null).not("proof_path", "is", null).limit(1),
    ]);
    if (club.error || court.error || payment.error) throw new Error("guest_status_unavailable");
    return json({ booking: { id: bookingId, tenant_id: booking.tenant_id, court_id: booking.court_id, guest_name: booking.guest_name, starts_at: booking.starts_at, ends_at: booking.ends_at, amount: booking.amount, status: booking.status, reference_code: booking.reference_code, expires_at: booking.expires_at, reject_reason: booking.reject_reason, cancel_reason: booking.cancel_reason, proof_submitted: !!payment.data?.length, gate_pass_available: booking.status === "approved" }, club: club.data, court: court.data });
  } catch { return json({ error: "service_unavailable" }, 503); }
});
