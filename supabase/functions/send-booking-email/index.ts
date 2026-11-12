// send-booking-email: called ONLY by the Database Webhook trigger on public.bookings
// (pg_net, shared secret in the x-webhook-secret header). The browser never calls it.
// It re-reads the booking from the database, builds the email from a template, sends it
// (Gmail API over HTTPS), and records every attempt in email_log.
//
// Idempotency: email_log has a unique index on (idempotency_key, to_address) and the key is
// "<booking_id>:<status>", so a replayed webhook never sends the same email twice.
//
// Secrets (Supabase secrets, never in the repo):
//   WEBHOOK_SECRET, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER
//   optional: SITE_URL, EMAIL_DRY_RUN=1 (records email_log as sent without sending)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { b64url, buildMime, type Ctx, type Inline, type Mail, planEmails, safeEqual } from "./lib.ts";
import { bookingQrPng } from "./qr.ts";
import { issueGuestBookingToken } from "../_shared/guest-access.ts";

// ---- Mailer: swap this for Resend later without touching the webhook, templates or email_log.
interface OutMail { fromName: string; fromEmail: string; to: string; replyTo?: string | null; subject: string; text: string; html: string; inline?: Inline[] }
interface Mailer { name: string; fromEmail: string; send(m: OutMail): Promise<string> }

function gmailMailer(): Mailer | null {
  const id = Deno.env.get("GMAIL_CLIENT_ID"), secret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refresh = Deno.env.get("GMAIL_REFRESH_TOKEN"), sender = Deno.env.get("GMAIL_SENDER");
  if (!id || !secret || !refresh || !sender) return null;
  let token: { value: string; exp: number } | null = null;
  async function accessToken(): Promise<string> {
    if (token && token.exp > Date.now() + 30_000) return token.value;
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id!, client_secret: secret!, refresh_token: refresh!, grant_type: "refresh_token" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error("gmail_token_failed: " + (j.error_description || j.error || r.status));
    token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return token.value;
  }
  return {
    name: "gmail",
    fromEmail: sender,
    async send(m) {
      const raw = b64url(new TextEncoder().encode(buildMime({ ...m, fromEmail: sender })));
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("gmail_send_failed: " + (j.error?.message || r.status));
      return String(j.id ?? "");
    },
  };
}
function dryRunMailer(): Mailer {
  return { name: "dry-run", fromEmail: "dry-run@localhost", send: (m) => Promise.resolve("dry-run:" + m.to) };
}
function getMailer(): Mailer | null {
  return Deno.env.get("EMAIL_DRY_RUN") === "1" ? dryRunMailer() : gmailMailer();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("WEBHOOK_SECRET");
  if (!expected) return json({ error: "server_misconfigured" }, 500);
  if (!safeEqual(req.headers.get("x-webhook-secret") ?? "", expected)) return json({ error: "unauthorized" }, 401);

  let payload: { type?: string; record?: { id?: string }; old_record?: { status?: string } | null };
  try { payload = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const bookingId = payload.record?.id;
  if (!bookingId || (payload.type !== "INSERT" && payload.type !== "UPDATE")) return json({ error: "bad_request" }, 400);

  const mailer = getMailer();
  if (!mailer) return json({ skipped: "email_not_configured" }); // nothing logged, so it can be sent once configured

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Re-read everything from the database; never trust the webhook body for content.
  const { data: b } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!b) return json({ skipped: "booking_not_found" });
  if (payload.type === "UPDATE" && payload.old_record?.status === b.status) return json({ skipped: "no_status_change" });

  const [{ data: tenant }, { data: court }, { data: player }, { data: members }] = await Promise.all([
    admin.from("tenants").select("id,name,slug,contact_email,timezone").eq("id", b.tenant_id).maybeSingle(),
    admin.from("courts").select("name").eq("id", b.court_id).maybeSingle(),
    b.player_id ? admin.from("club_players").select("display_name,user_id").eq("id", b.player_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("tenant_members").select("user_id").eq("tenant_id", b.tenant_id).is("deleted_at", null),
  ]);
  if (!tenant) return json({ skipped: "tenant_not_found" });

  async function emailOf(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  }
  const adminEmails = (await Promise.all((members ?? []).map((m: { user_id: string }) => emailOf(m.user_id)))).filter(Boolean) as string[];

  // Walk-in reservations without an email remain unchanged. Online guest contacts are private.
  let guestEmail: string | null = null, guestBookingUrl: string | null = null;
  if (!b.player_id) {
    const contact = await admin.from("guest_booking_contacts").select("email").eq("booking_id", b.id).maybeSingle();
    if (contact.error) return json({ error: "guest_contact_unavailable" }, 503);
    guestEmail = contact.data?.email ?? null;
    if (guestEmail) {
      try {
        const expiry = new Date(Math.max(Date.now() + 30 * 86400000, new Date(b.ends_at).getTime() + 7 * 86400000));
        const token = await issueGuestBookingToken(admin, b.id, expiry);
        const site = Deno.env.get("SITE_URL") ?? "https://jesdtprod.github.io/dinkslot/";
        guestBookingUrl = site.replace(/\/?$/, "/") + "#/guest/booking?token=" + encodeURIComponent(token);
      } catch { return json({ error: "guest_link_unavailable" }, 503); }
    }
  }

  const ctx: Ctx = {
    booking: b, clubName: tenant.name, clubSlug: tenant.slug, timezone: tenant.timezone || "Asia/Manila",
    courtName: court?.name ?? "Court", playerName: player?.display_name ?? b.guest_name ?? "Player",
    playerUserId: player?.user_id ?? null, playerEmail: guestEmail || await emailOf(player?.user_id), guestBookingUrl, adminEmails,
    siteUrl: Deno.env.get("SITE_URL") ?? "https://jesdtprod.github.io/dinkslot/",
  };

  const results: { to: string; template: string; result: string }[] = [];
  for (const mail of planEmails(ctx, payload.type === "INSERT") as Mail[]) {
    // Claim the (key, recipient) slot first. A replay hits the unique index and sends nothing.
    const { data: log, error: claimErr } = await admin.from("email_log").insert({
      tenant_id: b.tenant_id, booking_id: b.id, template: mail.template, to_address: mail.to,
      status: "pending", idempotency_key: mail.key,
    }).select("id").single();
    if (claimErr) {
      results.push({ to: mail.to, template: mail.template, result: claimErr.code === "23505" ? "duplicate_skipped" : "log_error" });
      continue;
    }
    try {
      // the approved email carries the ticket QR (same code as the ticket in the app) as an inline PNG
      const inline: Inline[] | undefined = mail.qr
        ? [{ cid: "ticket-qr", type: "image/png", filename: `booking-${mail.qr}.png`, data: bookingQrPng(mail.qr) }]
        : undefined;
      const id = await mailer.send({
        fromName: "DINKSLOT", fromEmail: mailer.fromEmail, to: mail.to, replyTo: tenant.contact_email,
        subject: mail.subject, text: mail.text, html: mail.html, inline,
      });
      await admin.from("email_log").update({ status: "sent", provider_message_id: id }).eq("id", log.id);
      results.push({ to: mail.to, template: mail.template, result: "sent" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("send failed", mail.template, msg);
      await admin.from("email_log").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", log.id);
      results.push({ to: mail.to, template: mail.template, result: "failed" });
    }
  }
  return json({ ok: true, mailer: mailer.name, results });
});
