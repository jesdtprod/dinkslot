// Pure logic for booking emails: who gets what, templates, MIME. No network, no secrets,
// so it can be unit tested (see lib_test.ts). The send step is swappable (index.ts Mailer).

export interface Ctx {
  booking: {
    id: string; status: string; starts_at: string; ends_at: string; amount: number | string;
    reference_code: string; reject_reason?: string | null; cancel_reason?: string | null;
    cancelled_by?: string | null; source?: string | null; guest_name?: string | null;
  };
  clubName: string;
  clubLogoUrl?: string | null;
  clubAddress?: string | null;
  clubEmail?: string | null;
  clubPhone?: string | null;
  clubSlug: string;
  timezone: string;
  courtName: string;
  playerName: string;
  playerUserId: string | null;
  playerEmail: string | null;
  adminEmails: string[];
  guestBookingUrl?: string | null;
  proofSubmitted?: boolean;
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

function contactRows(address?: string | null, email?: string | null, phone?: string | null): string {
  const entry = (icon: string, value: string, nowrap = true) => `<span style="display:inline-block;margin:4px 14px 0 0;font-size:12px;line-height:1.5;color:#65776e;${nowrap ? "white-space:nowrap" : ""}"><span aria-hidden="true" style="color:#527052">${icon}</span>&nbsp; ${escHtml(value)}</span>`;
  return (address ? `<div>${entry("&#128205;", address, false)}</div>` : "") + (email || phone ? `<div>${email ? entry("&#9993;", email) : ""}${phone ? entry("&#9742;", phone) : ""}</div>` : "");
}

function layout(ctx: Ctx, heading: string, lines: string[], cta?: { label: string; url: string }, qr?: string): { text: string; html: string } {
  const text = [heading, "", ...lines, ...(qr ? ["", `Show this booking code at the court: ${qr}`] : []), ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", `- ${ctx.clubName} (via DINKSLOT)`].join("\n");
  const detailNames = ["Court", "When", "Amount", "Booking code"];
  const intro = lines.filter((line) => !detailNames.some((name) => line.startsWith(name + ": ")));
  const detailLines = lines.filter((line) => detailNames.some((name) => line.startsWith(name + ": ")));
  const detailsHtml = `<p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#527052;text-transform:uppercase">Reservation details</p>${detailLines.map((line) => { const split = line.indexOf(": "); return `<p style="margin:0 0 9px;font-size:14px;line-height:1.5;color:#33464a"><span style="color:#65776e">${escHtml(line.slice(0, split))}:</span> <strong style="color:#1c3025">${escHtml(line.slice(split + 2))}</strong></p>`; }).join("")}`;
  const qrHtml = qr ? `<img src="cid:ticket-qr" width="150" height="150" alt="Booking QR code ${escHtml(qr)}" style="display:block;width:150px;height:150px;max-width:100%;background:#fff;border-radius:8px"><p style="margin:8px 0 0;font-size:12px;line-height:1.4;color:#52665a">Show this QR code at the court.</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#1c2930">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dfe6df;border-radius:16px">
<tr><td style="padding:22px 28px;border-bottom:3px solid #a3e635"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${ctx.clubLogoUrl ? `<td valign="top" style="padding-right:14px"><img src="${escHtml(ctx.clubLogoUrl)}" alt="${escHtml(ctx.clubName)} logo" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;border-radius:8px"></td>` : ""}<td><div style="font-weight:700;font-size:16px;color:#172820">${escHtml(ctx.clubName)} <span style="font-size:12px;color:#66806d;font-weight:400">&nbsp; | &nbsp; DINKSLOT</span></div>${contactRows(ctx.clubAddress, ctx.clubEmail, ctx.clubPhone)}</td></tr></table></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#172820">${escHtml(heading)}</h1>
${intro.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#42535b">${escHtml(l)}</p>`).join("")}
${detailLines.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f5f8f4;border:1px solid #e1e9df;border-radius:10px"><tr><td style="padding:16px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top" style="padding-right:${qr ? "12px" : "0"}">${detailsHtml}</td>${qr ? `<td valign="middle" align="center" width="150" style="width:150px">${qrHtml}</td>` : ""}</tr></table></td></tr></table>` : ""}
${cta ? `<p style="margin:22px 0 4px"><a href="${escHtml(cta.url)}" style="background:#a3e635;color:#1e310b;text-decoration:none;font-size:14px;font-weight:700;padding:13px 20px;border-radius:8px;display:inline-block">${escHtml(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;font-size:12px;line-height:1.5;color:#708078;border-top:1px solid #e8eee8">Sent by ${escHtml(ctx.clubName)} through DINKSLOT.<br>Book Your Slot. Own the Court.</td></tr>
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
  const myBookings = ctx.guestBookingUrl || ctx.siteUrl.replace(/\/?$/, "/") + "#/me";
  const queue = ctx.siteUrl.replace(/\/?$/, "/") + `#/admin/${ctx.clubSlug}/bookings`;
  const out: Mail[] = [];
  const toPlayer = (template: string, subject: string, heading: string, lines: string[], cta?: { label: string; url: string }, qr?: string) => {
    if (!ctx.playerEmail) return;
    const { text, html } = layout(ctx, heading, [`Hi ${ctx.playerName},`, ...lines], cta, qr);
    out.push({ template, to: ctx.playerEmail, subject: `${subject} - ${ctx.clubName}`, text, html, key, ...(qr ? { qr } : {}) });
  };
  const toAdmins = (template: string, subject: string, heading: string, lines: string[]) => {
    const { text, html } = layout(ctx, heading, lines, { label: "Approval Queue", url: queue });
    for (const to of new Set(ctx.adminEmails)) out.push({ template, to, subject, text, html, key });
  };

  if (status === "pending") {
    toPlayer("booking_received", `Booking Received - ${b.reference_code}`, "We received your booking",
      [ctx.proofSubmitted ? "Your payment proof has been received. The club will review it and confirm your reservation." : "Your reservation is on hold. Complete your payment and upload your proof so the club can review your booking.", ...details(ctx)],
      { label: ctx.proofSubmitted ? (ctx.guestBookingUrl ? "View Booking" : "View My Bookings") : "Pay and Upload Proof", url: myBookings });
    toAdmins("booking_request", `New Booking Request - ${b.reference_code}`, "New booking request",
      [`${ctx.playerName} requested a court.`, ...details(ctx)]);
  } else if (status === "approved") {
    toPlayer("booking_approved", `Booking Confirmed - ${b.reference_code}`, "Your booking is confirmed",
      ["Your booking is approved. Keep this email: the QR code below is your ticket.", ...details(ctx)], { label: ctx.guestBookingUrl ? "View Booking" : "View My Bookings", url: myBookings }, b.reference_code);
    // bookings the club created itself (walk-in or for a player) do not need an alert to the club
    if (isInsert && (b.source ?? "online") === "online") {
      toAdmins("booking_request", `New Booking - ${b.reference_code}`, "New booking (auto-approved)",
        [`${ctx.playerName} booked a court.`, ...details(ctx)]);
    }
  } else if (status === "rejected") {
    toPlayer("booking_rejected", `Booking Not Approved - ${b.reference_code}`, "Your booking was not approved",
      [`Reason: ${b.reject_reason || "not given"}`, ...details(ctx)], ctx.guestBookingUrl ? { label: "View Booking", url: ctx.guestBookingUrl } : { label: "Book Another Time", url: ctx.siteUrl });
  } else if (status === "cancelled") {
    toPlayer("booking_cancelled", `Booking Cancelled - ${b.reference_code}`, "Your booking was cancelled",
      [...(b.cancel_reason ? [`Reason: ${b.cancel_reason}`] : []), ...details(ctx)], { label: ctx.guestBookingUrl ? "View Booking" : "View My Bookings", url: myBookings });
    if (b.cancelled_by && b.cancelled_by === ctx.playerUserId) {
      toAdmins("booking_cancelled_admin", `Booking Cancelled by Player - ${b.reference_code}`, "A player cancelled",
        [`${ctx.playerName} cancelled their booking.`, ...details(ctx)]);
    }
  } else if (status === "expired") {
    toPlayer("booking_expired", `Booking Expired - ${b.reference_code}`, "Your booking expired",
      ["We did not receive payment in time, so the slot was released.", ...details(ctx)], ctx.guestBookingUrl ? { label: "View Booking", url: ctx.guestBookingUrl } : { label: "Book Again", url: ctx.siteUrl });
  }
  return out;
}

export function guestRecoveryEmail(links: { ref: string; url: string; club: string }[], brand: { logoUrl?: string | null; address?: string | null; email?: string | null; phone?: string | null } = {}, bookingsUrl?: string): { text: string; html: string } {
  const text = bookingsUrl ? "View all your guest bookings: " + bookingsUrl + "\n\nThis secure link expires in 7 days. Do not share it. If you did not request it, you may ignore this email." : "Your guest booking links:\n\n" + links.map((link) => link.club + " - " + link.ref + ": " + link.url).join("\n") + "\n\nIf you did not request these links, you may ignore this email.";
  const cards = bookingsUrl ? `<tr><td style="padding:20px;border:1px solid #e1e9df;border-radius:10px;background:#f5f8f4"><p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#42535b">See your upcoming, pending, and past guest bookings in one place, across all clubs booked with this email.</p><a href="${escHtml(bookingsUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#a3e635;color:#1e310b;font-size:14px;font-weight:700;text-decoration:none">View My Bookings</a><p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#65776e">This secure link expires in 7 days. Keep it private. You can request a new link anytime.</p></td></tr>` : links.map((link) => `<tr><td style="padding:14px 16px;border:1px solid #e1e9df;border-radius:10px;background:#f5f8f4"><p style="margin:0 0 5px;font-size:15px;font-weight:700;color:#172820">${escHtml(link.club)}</p><p style="margin:0 0 12px;font-size:13px;color:#65776e">Booking code: <strong>${escHtml(link.ref)}</strong></p><a href="${escHtml(link.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#a3e635;color:#1e310b;font-size:14px;font-weight:700;text-decoration:none">View Booking</a></td></tr><tr><td height="10"></td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f2;font-family:Arial,Helvetica,sans-serif;color:#1c2930"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dfe6df;border-radius:16px"><tr><td style="padding:22px 28px;border-bottom:3px solid #a3e635"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${brand.logoUrl ? `<td valign="top" style="padding-right:14px"><img src="${escHtml(brand.logoUrl)}" alt="DINKSLOT logo" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain"></td>` : ""}<td><div style="font-size:16px;font-weight:700;color:#172820">DINKSLOT</div><div style="margin-top:4px;font-size:12px;line-height:1.4;color:#65776e">Book Your Slot. Own the Court.</div></td></tr></table></td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#172820">Your Guest Bookings</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#42535b">${bookingsUrl ? "Use your secure link below to access all your guest bookings." : "Use a secure link below to view your booking details and status."}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table><p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#65776e">If you did not request these links, you may ignore this email.</p></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #e8eee8;font-size:12px;color:#708078">DINKSLOT &middot; Book Your Slot. Own the Court.</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
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
