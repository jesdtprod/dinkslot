import { createGuestToken, guestTokenDigest } from "./guest-token.ts";

// A single-booking token must never grant access to other bookings.
export async function issueGuestCollectionToken(
  db: { from: (table: string) => any }, email: string, now = new Date(),
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error("invalid_email");
  const token = createGuestToken();
  const { error } = await db.from("guest_booking_collection_tokens").insert({
    token_hash: await guestTokenDigest(token), email: normalized,
    expires_at: new Date(now.getTime() + 7 * 86400000).toISOString(),
  });
  if (error) throw new Error("guest_collection_unavailable");
  return token;
}

export async function resolveGuestCollection(
  db: { from: (table: string) => any }, token: string, now = new Date(),
): Promise<string | null> {
  let hash: string;
  try { hash = await guestTokenDigest(token); } catch { return null; }
  const { data, error } = await db.from("guest_booking_collection_tokens")
    .select("email,expires_at,revoked_at").eq("token_hash", hash)
    .is("revoked_at", null).gt("expires_at", now.toISOString()).maybeSingle();
  if (error) throw new Error("guest_collection_unavailable");
  if (!data || data.revoked_at !== null || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= now.getTime()) return null;
  return typeof data.email === "string" && data.email ? data.email : null;
}

// Every read is scoped by the email resolved from the recovery token, never by
// an email supplied by the browser. Pagination keeps the full history accessible.
export function collectionBookings(db: { from: (table: string) => any }, email: string, head = false) {
  return db.from("bookings").select(
    "id,tenant_id,court_id,guest_name,starts_at,ends_at,amount,status,reference_code,expires_at,guest_booking_contacts!inner(email)",
    { count: "exact", head },
  ).eq("guest_booking_contacts.email", email).eq("source", "guest_online").is("deleted_at", null);
}
