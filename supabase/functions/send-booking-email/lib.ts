// Pure logic for booking emails: who gets what, templates, MIME. No network, no secrets,
// so it can be unit tested (see lib_test.ts). The send step is swappable (index.ts Mailer).

export interface Ctx {
  booking: {
    id: string; status: string; starts_at: string; ends_at: string; amount: number | string;
    reference_code: string; reject_reason?: string | null; cancel_reason?: string | null;
    cancelled_by?: string | null; source?: string | null; guest_name?: string | null;
  };
  clubName: string;
  clubSlug: string;
  timezone: string;
  courtName: string;
  playerName: string;
  playerUserId: string | null;
  playerEmail: string | null;
  adminEmails: string[];
  siteUrl: string; // e.g. https://jesdtprod.github.io/dinkslot/
}

export interface Mail {
  template: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  key: string; // idempotency key: booking_id:status (unique together with the recipient)
  qr?: string; // when set, the email carries a ticket QR (PNG, inline) encoding this text (the booking code)
}

export function escHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function money(n: number | string): string {
  return "PHP " + Number(n).toFixed(2);
}

export function fmtRange(startIso: string, endIso: string, tz: string): string {
  const a = new Date(startIso), b = new Date(endIso);
  const day = a.toLocaleDateString("en-PH", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(a)} - ${t(b)}`;
}

function layout(ctx: Ctx, heading: string, lines: string[], cta?: { label: string; url: string }, qr?: string): { text: string; html: string } {
  const text = [heading, "", ...lines, ...(qr ? ["", `Show this booking code at the court: ${qr}`] : []), ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", `- ${ctx.clubName} (via DINKSLOT)`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#10141a;font-family:Arial,Helvetica,sans-serif;color:#dfe2eb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#181c22;border:1px solid #262a31;border-radius:16px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #a3e635;font-weight:700;font-size:16px;letter-spacing:.04em">${escHtml(ctx.clubName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:20px;color:#ccff80">${escHtml(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55">${escHtml(l)}</p>`).join("")}
${qr ? `<p style="margin:18px 0 6px;text-align:center"><img src="cid:ticket-qr" width="220" height="220" alt="Booking QR code ${escHtml(qr)}" style="display:inline-block;width:220px;height:220px;border-radius:12px;background:#ffffff"></p><p style="margin:0 0 6px;text-align:center;font-size:13px;color:#c2cab0">Show this QR code at the court.<br>Booking code <b style="color:#ccff80;letter-spacing:.06em">${escHtml(qr)}</b></p>` : ""}
${cta ? `<p style="margin:20px 0 4px"><a href="${escHtml(cta.url)}" style="background:#a3e635;color:#213600;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px;display:inline-block">${escHtml(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;font-size:12px;color:#8c947c;border-top:1px solid #262a31">Sent by ${escHtml(ctx.clubName)} through DINKSLOT. Book Your Slot. Own the Court.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

function details(ctx: Ctx): string[] {
  const b = ctx.booking;
  return [
    `Court: ${ctx.courtName}`,
    `When: ${fmtRange(b.starts_at, b.ends_at, ctx.timezone)}`,
    `Amount: ${money(b.amount)}`,
    `Booking code: ${b.reference_code}`,
  ];
}

// Decide who gets which email for a booking that just reached `status`.
// isInsert: the booking was just created. cancelledByPlayer: the player cancelled it.
export function planEmails(ctx: Ctx, isInsert: boolean): Mail[] {
  const b = ctx.booking, status = b.status, key = `${b.id}:${status}`;
  const myBookings = ctx.siteUrl.replace(/\/?$/, "/") + "#/me";
  const queue = ctx.siteUrl.replace(/\/?$/, "/") + `#/admin/${ctx.clubSlug}/bookings`;
  const out: Mail[] = [];
  const toPlayer = (template: string, subject: string, heading: string, lines: string[], cta?: { label: string; url: string }, qr?: string) => {
    if (!ctx.playerEmail) return;
    const { text, html } = layout(ctx, heading, [`Hi ${ctx.playerName},`, ...lines], cta, qr);
    out.push({ template, to: ctx.playerEmail, subject: `${subject} - ${ctx.clubName}`, text, html, key, ...(qr ? { qr } : {}) });
  };
  const toAdmins = (template: string, subject: string, heading: string, lines: string[]) => {
    const { text, html } = layout(ctx, heading, lines, { label: "Open the approval queue", url: queue });
    for (const to of new Set(ctx.adminEmails)) out.push({ template, to, subject, text, html, key });
  };

  if (status === "pending") {
    toPlayer("booking_received", `Booking received - ${b.reference_code}`, "We received your booking",
      ["Your booking request is in. Pay with the club's QR and upload your proof so the club can confirm it.", ...details(ctx)],
      { label: "Pay and upload proof", url: myBookings });
    toAdmins("booking_request", `New booking request - ${b.reference_code}`, "New booking request",
      [`${ctx.playerName} requested a court.`, ...details(ctx)]);
  } else if (status === "approved") {
    toPlayer("booking_approved", `Booking confirmed - ${b.reference_code}`, "Your booking is confirmed",
      ["Your booking is approved. Keep this email: the QR code below is your ticket.", ...details(ctx)], { label: "View my bookings", url: myBookings }, b.reference_code);
    // bookings the club created itself (walk-in or for a player) do not need an alert to the club
    if (isInsert && (b.source ?? "online") === "online") {
      toAdmins("booking_request", `New booking - ${b.reference_code}`, "New booking (auto-approved)",
        [`${ctx.playerName} booked a court.`, ...details(ctx)]);
    }
  } else if (status === "rejected") {
    toPlayer("booking_rejected", `Booking not approved - ${b.reference_code}`, "Your booking was not approved",
      [`Reason: ${b.reject_reason || "not given"}`, ...details(ctx)], { label: "Book another time", url: ctx.siteUrl });
  } else if (status === "cancelled") {
    toPlayer("booking_cancelled", `Booking cancelled - ${b.reference_code}`, "Your booking was cancelled",
      [...(b.cancel_reason ? [`Reason: ${b.cancel_reason}`] : []), ...details(ctx)], { label: "View my bookings", url: myBookings });
    if (b.cancelled_by && b.cancelled_by === ctx.playerUserId) {
      toAdmins("booking_cancelled_admin", `Booking cancelled by player - ${b.reference_code}`, "A player cancelled",
        [`${ctx.playerName} cancelled their booking.`, ...details(ctx)]);
    }
  } else if (status === "expired") {
    toPlayer("booking_expired", `Booking expired - ${b.reference_code}`, "Your booking expired",
      ["We did not receive payment in time, so the slot was released.", ...details(ctx)], { label: "Book again", url: ctx.siteUrl });
  }
  return out;
}

// ------------------------------------------------------------------ MIME
export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const enc = new TextEncoder();
function wrap76(s: string): string { return s.replace(/(.{76})/g, "$1\r\n"); }
function encWord(s: string): string { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc.encode(s))}?=`; }
function noCrlf(s: string): string { return s.replace(/[\r\n]+/g, " ").trim(); }

export interface Inline { cid: string; type: string; filename: string; data: Uint8Array }
export interface Out {
  fromName: string; fromEmail: string; to: string; replyTo?: string | null;
  subject: string; text: string; html: string;
  inline?: Inline[]; // images shown inside the HTML (cid:...)
}

export function buildMime(m: Out, boundary = "ds_" + crypto.randomUUID().replace(/-/g, ""), relBoundary = "rel_" + crypto.randomUUID().replace(/-/g, "")): string {
  const inline = m.inline ?? [];
  const headers = [
    `From: ${encWord(noCrlf(m.fromName))} <${noCrlf(m.fromEmail)}>`,
    `To: ${noCrlf(m.to)}`,
    ...(m.replyTo ? [`Reply-To: ${noCrlf(m.replyTo)}`] : []),
    `Subject: ${encWord(noCrlf(m.subject))}`,
    "MIME-Version: 1.0",
    inline.length ? `Content-Type: multipart/related; boundary="${relBoundary}"` : `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(enc.encode(body)))}\r\n`;
  const alternative = part("text/plain", m.text) + part("text/html", m.html) + `--${boundary}--\r\n`;
  if (!inline.length) return headers.join("\r\n") + "\r\n\r\n" + alternative;
  // multipart/related: the text+HTML alternatives, then each inline image referenced as cid:<id>
  const images = inline.map((i) =>
    `--${relBoundary}\r\nContent-Type: ${i.type}; name="${noCrlf(i.filename)}"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${noCrlf(i.cid)}>\r\n` +
    `Content-Disposition: inline; filename="${noCrlf(i.filename)}"\r\n\r\n${wrap76(b64(i.data))}\r\n`).join("");
  return headers.join("\r\n") + "\r\n\r\n" +
    `--${relBoundary}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` + alternative + images + `--${relBoundary}--\r\n`;
}

export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
