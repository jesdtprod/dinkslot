import { guestTokenDigest } from "./guest-token.ts";

// Call only from trusted server code using a service-role client. Never expose this client to browsers.
export async function resolveGuestBooking(
  client: { from: (table: string) => any },
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  let digest: string;
  try { digest = await guestTokenDigest(token); } catch { return null; }
  const { data, error } = await client.from("guest_booking_access_tokens")
    .select("booking_id,expires_at,revoked_at")
    .eq("token_hash", digest)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) throw new Error("guest_access_unavailable");
  if (!data || data.revoked_at !== null || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= now.getTime()) return null;
  return typeof data.booking_id === "string" && data.booking_id ? data.booking_id : null;
}
