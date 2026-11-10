// verify-turnstile: confirms a Cloudflare Turnstile token server-side, then records a
// one-time CAPTCHA pass for the signed-in user. register_club consumes that pass.
// The secret key and service role key exist only here (Supabase secrets), never in the repo.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PURPOSES = new Set(["register_club"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return json({ error: "server_misconfigured" }, 500);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "not_authenticated" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: "not_authenticated" }, 401);

  let body: { token?: string; purpose?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const token = body.token ?? "";
  const purpose = body.purpose ?? "";
  if (!token || token.length > 2048 || !PURPOSES.has(purpose)) return json({ error: "bad_request" }, 400);

  const form = new URLSearchParams({ secret, response: token });
  const ip = req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (ip) form.set("remoteip", ip);

  const cf = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const result = await cf.json().catch(() => ({ success: false }));
  if (!result.success) {
    console.error("turnstile rejected", JSON.stringify(result["error-codes"] ?? []), "host", result.hostname ?? "");
    return json({ success: false, error: "captcha_failed", codes: result["error-codes"] ?? [] }, 400);
  }

  const { error: insErr } = await admin
    .from("captcha_passes")
    .insert({ user_id: userData.user.id, purpose });
  if (insErr) {
    console.error("captcha_passes insert failed", insErr.message);
    return json({ error: "server_error", detail: insErr.message }, 500);
  }

  return json({ success: true });
});
