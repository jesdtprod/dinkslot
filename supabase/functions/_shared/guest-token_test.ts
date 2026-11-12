import { createGuestToken, guestTokenDigest } from "./guest-token.ts";

Deno.test("guest tokens have 256 bits of random input and stable digests", async () => {
  const token = createGuestToken();
  if (!/^[0-9a-f]{64}$/.test(token) || token === createGuestToken()) throw new Error("invalid token");
  const digest = await guestTokenDigest(token);
  if (digest === token || digest !== await guestTokenDigest(token)) throw new Error("invalid digest");
});

Deno.test("malformed guest tokens are rejected", async () => {
  for (const token of ["", "abc", "g".repeat(64), "A".repeat(64)]) {
    let rejected = false;
    try { await guestTokenDigest(token); } catch { rejected = true; }
    if (!rejected) throw new Error("accepted malformed token");
  }
});
