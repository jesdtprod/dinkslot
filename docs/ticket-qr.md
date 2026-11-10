# Booking ticket QR (club side)

In the club's booking list, **Ticket** shows a QR with the booking code, the player or guest name, the court and the time. It can be downloaded as an SVG. The QR carries only the booking reference code (for example `DS-ABC123XYZ`).

## Look
Soft rounded-square modules, rounded corner squares, and a small **DINKSLOT logo in the centre** (`assets/icons/qr-logo.png`, embedded into the SVG so the downloaded file works on its own). If the logo cannot be loaded, a plain dot is drawn instead and the code still works.

## Why it was changed
The earlier version drew small round dots (radius 0.42 of a module). Tested with a real scanner (jsQR in a browser), **those codes did not scan at all (0 of 8)**, with or without a logo, even though a plain square code scanned 4 of 4. Dots need to be nearly touching. The final style uses rounded squares (0.94 of a module, corner radius 0.3) and was chosen from these results:

| Style | Scans |
| --- | --- |
| Plain squares | 4 / 4 |
| Round dots, radius 0.42 (old) | 0 / 4 |
| Round dots, radius 0.50 | 7 / 8 |
| **Rounded squares 0.94 (used)** | **8 / 8** |

## Logo size
Error correction is level H (about 30% of the code can be unreadable). The logo is 6 modules wide and sits on a plain white block (no border) exactly as big as the 7 x 5 modules left out for it, about 4% of the code, so no module is half hidden and there is almost no empty margin. Final check: 8 different booking codes scanned correctly **with** the logo and **without** it.

## Tip
Phone cameras are usually more forgiving than the test scanner, but print or show the ticket at least 3 cm wide and scan one real ticket with a phone before relying on it at the door.

## Ticket QR in the approved email
When a booking becomes **approved**, the registered player gets the "Booking confirmed" email with the same ticket QR (booking code, DINKSLOT logo in the centre) shown inside the email as an inline PNG (`supabase/functions/send-booking-email/qr.ts`, `cid:ticket-qr`). The text version of the email shows the booking code. This also applies to bookings the club creates for a registered player. The "Booking received" email goes to the player when the booking is created (pending). Walk-in guests have no account email, so they get nothing. Tests: `deno test -A lib_test.ts qr_test.ts` (the PNG is decoded with jsQR). Emails only go out once Gmail is configured (`scripts/setup-email.ps1`, see `gmail-setup.md`).
