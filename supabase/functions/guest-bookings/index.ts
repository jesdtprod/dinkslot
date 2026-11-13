import { createClient } from "jsr:@supabase/supabase-js@2";
import { collectionBookings, resolveGuestCollection } from "../_shared/guest-collection.ts";
import { issueGuestBookingToken } from "../_shared/guest-access.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
type BookingRow = {
  id: string; tenant_id: string; court_id: string; guest_name: string;
  starts_at: string; ends_at: string; amount: number; status: string;
  reference_code: string; expires_at: string | null; guest_booking_contacts?: unknown;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { token?: unknown; page?: unknown; filter?: unknown; booking_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_request" }, 400); }
  if (typeof body?.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token)) return json({ error: "invalid_or_expired_link" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "service_unavailable" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const email = await resolveGuestCollection(db, body.token);
    if (!email) return json({ error: "invalid_or_expired_link" }, 401);
    if (body.booking_id !== undefined) {
      if (typeof body.booking_id !== "string" || !body.booking_id || body.booking_id.length > 100) return json({ error: "invalid_request" }, 400);
      const { data: booking, error } = await collectionBookings(db, email).eq("id", body.booking_id).maybeSingle();
      if (error) throw error;
      if (!booking) return json({ error: "booking_unavailable" }, 404);
      // Exchange collection access for an existing single-booking flow only
      // after checking that the booking belongs to the recovered email.
      const token = await issueGuestBookingToken(db, booking.id, new Date(Date.now() + 7 * 86400000));
      return json({ token });
    }
    const page = body.page === undefined ? 0 : body.page;
    const filter = body.filter === undefined ? "all" : body.filter;
    if (!Number.isInteger(page) || (page as number) < 0 || (page as number) > 100000 || !["all", "upcoming", "pending", "past"].includes(filter as string)) return json({ error: "invalid_request" }, 400);
    const now = new Date().toISOString();
    let query = collectionBookings(db, email);
    if (filter === "upcoming") query = query.eq("status", "approved").gt("ends_at", now);
    if (filter === "pending") query = query.eq("status", "pending").gt("ends_at", now);
    if (filter === "past") query = query.or(`ends_at.lte.${now},status.in.(cancelled,rejected,expired)`);
    const start = (page as number) * 12;
    const { data, error, count } = await query.order("starts_at", { ascending: false }).order("id", { ascending: false }).range(start, start + 11);
    if (error) throw error;
    const bookings = (data || []) as BookingRow[];
    if (!bookings.length) return json({ bookings: [], total: count || 0, page });
    const [clubs, courts, payments] = await Promise.all([
      db.from("tenants").select("id,name,slug,timezone,logo_path,address,city,province,zip_code").in("id", [...new Set(bookings.map((b) => b.tenant_id))]),
      db.from("courts").select("id,tenant_id,name,surface").in("id", [...new Set(bookings.map((b) => b.court_id))]),
      db.from("booking_payments").select("booking_id").in("booking_id", bookings.map((b) => b.id)).is("deleted_at", null).not("proof_path", "is", null),
    ]);
    if (clubs.error || courts.error || payments.error) throw new Error("guest_collection_unavailable");
    const proofIds = new Set((payments.data || []).map((p) => p.booking_id));
    return json({ bookings: bookings.map((b) => {
      const { guest_booking_contacts: _contacts, ...booking } = b;
      return { booking: { ...booking, proof_submitted: proofIds.has(b.id) }, club: clubs.data?.find((c) => c.id === b.tenant_id) || null, court: courts.data?.find((c) => c.id === b.court_id && c.tenant_id === b.tenant_id) || null };
    }), total: count || 0, page });
  } catch { return json({ error: "service_unavailable" }, 503); }
});
