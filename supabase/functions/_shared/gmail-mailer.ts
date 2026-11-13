import { b64url, buildMime, type Inline } from "../send-booking-email/lib.ts";

// ---- Mailer: swap this for Resend later without touching the webhook, templates or email_log.
export interface OutMail { fromName: string; fromEmail: string; to: string; replyTo?: string | null; subject: string; text: string; html: string; inline?: Inline[] }
export interface Mailer { name: string; fromEmail: string; send(m: OutMail): Promise<string> }

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
export function getMailer(): Mailer | null {
  return Deno.env.get("EMAIL_DRY_RUN") === "1" ? dryRunMailer() : gmailMailer();
}

