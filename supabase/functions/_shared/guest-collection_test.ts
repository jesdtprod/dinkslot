import { collectionBookings, issueGuestCollectionToken, resolveGuestCollection } from "./guest-collection.ts";
import { createGuestToken, guestTokenDigest } from "./guest-token.ts";

Deno.test("collection recovery stores a hashed, email-scoped token with seven-day expiry", async () => {
  let saved: any, table = "";
  const db = { from: (name: string) => { table = name; return { insert: (row: unknown) => { saved = row; return Promise.resolve({ error: null }); } }; } };
  const now = new Date("2026-11-13T00:00:00Z");
  const token = await issueGuestCollectionToken(db, " Guest@Example.test ", now);
  if (table !== "guest_booking_collection_tokens" || saved.email !== "guest@example.test" || saved.token_hash !== await guestTokenDigest(token) || saved.token_hash === token || saved.expires_at !== "2026-11-20T00:00:00.000Z") throw new Error("unsafe collection token");
});

Deno.test("single-booking tokens, revoked tokens, malformed tokens, and expired collection links cannot open a collection", async () => {
  const now = new Date("2026-11-13T00:00:00Z"), token = createGuestToken();
  const mock = (record: unknown) => ({ from: (table: string) => {
    if (table !== "guest_booking_collection_tokens") throw new Error("single-booking scope used for collection");
    const query = { select: () => query, eq: () => query, is: () => query, gt: () => query, maybeSingle: () => Promise.resolve({ data: record, error: null }) };
    return query;
  } });
  const valid = { email: "guest@example.test", expires_at: "2026-11-14T00:00:00Z", revoked_at: null };
  if (await resolveGuestCollection(mock(valid), token, now) !== valid.email) throw new Error("valid link rejected");
  for (const record of [null, { ...valid, revoked_at: now.toISOString() }, { ...valid, expires_at: now.toISOString() }, { ...valid, expires_at: "invalid" }]) {
    if (await resolveGuestCollection(mock(record), token, now) !== null) throw new Error("invalid link accepted");
  }
  if (await resolveGuestCollection(mock(valid), "bad", now) !== null) throw new Error("malformed link accepted");
});

Deno.test("collection reads and single-booking exchanges are scoped to the verified email and online guest bookings", () => {
  const calls: unknown[] = [];
  const query = { select: (...args: unknown[]) => { calls.push(["select", ...args]); return query; }, eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return query; }, is: (...args: unknown[]) => { calls.push(["is", ...args]); return query; } };
  collectionBookings({ from: (table: string) => { if (table !== "bookings") throw new Error("wrong table"); return query; } }, "verified@example.test").eq("id", "requested-booking");
  const expected = [["eq", "guest_booking_contacts.email", "verified@example.test"], ["eq", "source", "guest_online"], ["is", "deleted_at", null], ["eq", "id", "requested-booking"]];
  if (JSON.stringify(calls.slice(1)) !== JSON.stringify(expected)) throw new Error("unscoped booking access");
  if (!String((calls[0] as unknown[])[1]).includes("guest_booking_contacts!inner(email)")) throw new Error("contact match must be an inner join");
});

Deno.test("collection token issuance fails closed on database errors", async () => {
  let failed = false;
  try { await issueGuestCollectionToken({ from: () => ({ insert: () => Promise.resolve({ error: { message: "unavailable" } }) }) }, "guest@example.test"); } catch { failed = true; }
  if (!failed) throw new Error("database failure ignored");
});

Deno.test("collection counts use exact head queries scoped to the verified guest email", () => {
  let options: any;
  const scope: unknown[] = [];
  const query = {
    select: (_fields: string, config: unknown) => { options = config; return query; },
    eq: (...args: unknown[]) => { scope.push(args); return query; },
    is: (...args: unknown[]) => { scope.push(args); return query; },
  };
  collectionBookings({ from: () => query }, "verified@example.test", true);
  if (options.count !== "exact" || options.head !== true) throw new Error("count query returns rows or uses an estimate");
  if (JSON.stringify(scope) !== JSON.stringify([["guest_booking_contacts.email", "verified@example.test"], ["source", "guest_online"], ["deleted_at", null]])) throw new Error("count query is not scoped");
});
