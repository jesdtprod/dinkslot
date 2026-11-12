// Run: deno test supabase/functions/send-booking-email/lib_test.ts
import { buildMime, type Ctx, escHtml, fmtRange, planEmails, safeEqual } from "./lib.ts";

function ctx(over: Partial<Ctx["booking"]> = {}, c: Partial<Ctx> = {}): Ctx {
  return {
    booking: {
      id: "B1", status: "pending", starts_at: "2026-11-12T02:00:00Z", ends_at: "2026-11-12T03:00:00Z",
      amount: "300.00", reference_code: "DS-ABC123", ...over,
    },
    clubName: "The Pickleshot", clubSlug: "the-pickleshot", timezone: "Asia/Manila", courtName: "Court 1",
    playerName: "Emee", playerUserId: "U-player", playerEmail: "player@x.com",
    adminEmails: ["owner@x.com", "staff@x.com", "owner@x.com"], siteUrl: "https://jesdtprod.github.io/dinkslot/", ...c,
  };
}
const who = (m: { to: string; template: string }[]) => m.map((x) => `${x.template}:${x.to}`).sort();

Deno.test("new pending booking: player gets 'received', each admin gets 'request' once", () => {
  const m = planEmails(ctx(), true);
  if (JSON.stringify(who(m)) !== JSON.stringify(["booking_received:player@x.com", "booking_request:owner@x.com", "booking_request:staff@x.com"].sort())) {
    throw new Error("unexpected recipients: " + who(m));
  }
  if (!m.every((x) => x.key === "B1:pending")) throw new Error("bad key");
});

Deno.test("approved by admin: only the player; auto-approved insert also tells admins", () => {
  const upd = planEmails(ctx({ status: "approved" }), false);
  if (who(upd).join() !== "booking_approved:player@x.com") throw new Error(who(upd).join());
  const ins = planEmails(ctx({ status: "approved" }), true);
  if (ins.length !== 3) throw new Error("expected 3, got " + ins.length);
});

Deno.test("rejected includes the reason", () => {
  const m = planEmails(ctx({ status: "rejected", reject_reason: "Wrong amount" }), false);
  if (m.length !== 1 || !m[0].text.includes("Wrong amount") || m[0].key !== "B1:rejected") throw new Error("rejected mail wrong");
});

Deno.test("cancelled: admin cancel tells only the player; player cancel also tells admins", () => {
  const byAdmin = planEmails(ctx({ status: "cancelled", cancel_reason: "Court flooded", cancelled_by: "U-admin" }), false);
  if (byAdmin.length !== 1) throw new Error("admin cancel should email only player");
  const byPlayer = planEmails(ctx({ status: "cancelled", cancelled_by: "U-player" }), false);
  if (byPlayer.length !== 3) throw new Error("player cancel should email player + 2 admins");
});

Deno.test("expired goes to the player only", () => {
  const m = planEmails(ctx({ status: "expired" }), false);
  if (who(m).join() !== "booking_expired:player@x.com") throw new Error(who(m).join());
});

Deno.test("no player email -> no player mail, admins still notified", () => {
  const m = planEmails(ctx({}, { playerEmail: null }), true);
  if (m.some((x) => x.to === "player@x.com") || m.length !== 2) throw new Error("wrong recipients");
});

Deno.test("HTML escapes untrusted text", () => {
  const m = planEmails(ctx({ status: "rejected", reject_reason: "<script>alert(1)</script>" }), false);
  if (m[0].html.includes("<script>")) throw new Error("unescaped html");
  if (escHtml(`"'<>&`) !== "&quot;&#39;&lt;&gt;&amp;") throw new Error("escHtml");
});

Deno.test("times are shown in the club timezone", () => {
  const s = fmtRange("2026-11-12T02:00:00Z", "2026-11-12T03:00:00Z", "Asia/Manila");
  if (!s.includes("10:00") || !s.includes("11:00") || !s.includes("2026")) throw new Error(s);
});

Deno.test("MIME: headers, no header injection, UTF-8 subject, base64 bodies decode", () => {
  const mime = buildMime({
    fromName: "Club\r\nBcc: evil@x.com", fromEmail: "sender@gmail.com", to: "p@x.com", replyTo: "club@x.com",
    subject: "Booking confirmed ✓", text: "Hello é", html: "<p>Hello</p>",
  }, "BND");
  const head = mime.split("\r\n\r\n")[0];
  if (/^Bcc:/mi.test(head)) throw new Error("header injection");
  if (!head.includes("Reply-To: club@x.com") || !head.includes("Subject: =?UTF-8?B?")) throw new Error("headers");
  const m = mime.match(/text\/plain[^]*?\r\n\r\n([^]*?)\r\n--BND/);
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(m![1].replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
  if (decoded !== "Hello é") throw new Error("body decode: " + decoded);
});

Deno.test("safeEqual", () => {
  if (!safeEqual("abc", "abc") || safeEqual("abc", "abd") || safeEqual("abc", "abcd") || safeEqual("", "x")) throw new Error("safeEqual");
});

Deno.test("booking made by the club: player is told, admins are not alerted; guests get no email", () => {
  const forPlayer = planEmails(ctx({ status: "approved", source: "admin" }), true);
  if (who(forPlayer).join() !== "booking_approved:player@x.com") throw new Error(who(forPlayer).join());
  const guest = planEmails(ctx({ status: "approved", source: "walk_in", guest_name: "Juan" }, { playerEmail: null, playerUserId: null }), true);
  if (guest.length !== 0) throw new Error("a walk-in guest has no email and admins need no alert");
});

Deno.test("approved email carries the ticket QR (booking code); other emails do not", () => {
  const approved = planEmails(ctx({ status: "approved" }), false);
  if (approved.length !== 1 || approved[0].qr !== "DS-ABC123") throw new Error("approved mail should carry qr");
  if (!approved[0].html.includes('src="cid:ticket-qr"')) throw new Error("html must reference the inline QR");
  if (!approved[0].text.includes("DS-ABC123")) throw new Error("text version must show the code");
  for (const st of ["pending", "rejected", "cancelled", "expired"]) {
    const m = planEmails(ctx({ status: st }), st === "pending");
    if (m.some((x) => x.qr || x.html.includes("cid:ticket-qr"))) throw new Error(st + " mail must not carry a QR");
  }
});

Deno.test("approved booking made by the club for a registered player also carries the QR", () => {
  const m = planEmails(ctx({ status: "approved", source: "admin" }), true);
  if (m.length !== 1 || m[0].qr !== "DS-ABC123" || m[0].to !== "player@x.com") throw new Error("club-made booking for a player needs the QR email");
});

Deno.test("MIME with an inline image: multipart/related, Content-ID, bytes intact", () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 250, 251, 252]);
  const mime = buildMime({
    fromName: "Club", fromEmail: "s@gmail.com", to: "p@x.com", subject: "Confirmed", text: "t", html: '<img src="cid:ticket-qr">',
    inline: [{ cid: "ticket-qr", type: "image/png", filename: "booking-DS-1.png", data: png }],
  }, "ALT", "REL");
  const head = mime.split("\r\n\r\n")[0];
  if (!head.includes('multipart/related; boundary="REL"')) throw new Error("outer type");
  if (!mime.includes('multipart/alternative; boundary="ALT"') || !mime.includes("Content-ID: <ticket-qr>") || !mime.includes("Content-Disposition: inline")) throw new Error("structure");
  const m = mime.match(/Content-ID: <ticket-qr>[^]*?\r\n\r\n([^]*?)\r\n--REL--/);
  const bytes = Uint8Array.from(atob(m![1].replace(/\r\n/g, "")), (c) => c.charCodeAt(0));
  if (bytes.length !== png.length || bytes.some((v, i) => v !== png[i])) throw new Error("image bytes changed");
  if (!mime.trim().endsWith("--REL--")) throw new Error("closing boundary");
});

Deno.test('player booking emails identify the club in the subject', () => {
  for (const status of ['pending', 'approved', 'rejected', 'cancelled', 'expired']) {
    const mail = planEmails(ctx({ status }), false).find((item) => item.to === 'player@x.com');
    if (!mail || !mail.subject.includes('The Pickleshot')) throw new Error('missing club for ' + status);
  }
});
