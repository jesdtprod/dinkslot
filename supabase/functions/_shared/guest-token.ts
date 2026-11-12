// High-entropy bearer tokens for guest booking links. Store only the digest.
export function createGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function guestTokenDigest(token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("invalid_guest_token");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
