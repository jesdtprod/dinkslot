import { createGuestToken } from "./guest-token.ts";
import { resolveGuestBooking } from "./guest-access.ts";

Deno.test("guest access accepts only active, unexpired records", async () => {
  const now = new Date("2026-11-12T12:00:00Z"), token = createGuestToken();
  const make = (data: unknown, error: unknown = null) => ({ from: (_table: string) => {
    const query = { select: (_s: string) => query, eq: (_k: string, _v: string) => query, is: (_k: string, _v: null) => query, gt: (_k: string, _v: string) => query, maybeSingle: () => Promise.resolve({data, error}) }; return query;
  } });
  const good = {booking_id:"booking-1", expires_at:"2026-11-12T12:01:00Z", revoked_at:null};
  if (await resolveGuestBooking(make(good), token, now) !== "booking-1") throw new Error("valid token rejected");
  for (const record of [null, {...good, revoked_at:"2026-11-12T11:00:00Z"}, {...good, expires_at:"2026-11-12T12:00:00Z"}, {...good, expires_at:"bad"}]) {
    if (await resolveGuestBooking(make(record), token, now) !== null) throw new Error("invalid token accepted");
  }
  if (await resolveGuestBooking(make(good), "bad", now) !== null) throw new Error("malformed token accepted");
  let failed = false;
  try { await resolveGuestBooking(make(null, {message:"database failure"}), token, now); } catch { failed = true; }
  if (!failed) throw new Error("database failure suppressed");
});
