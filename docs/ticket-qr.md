# Booking ticket QR (club side)

In the club's booking list, **Ticket** shows a QR with the booking code, the player or guest name, the court and the time. It can be downloaded as an SVG. The QR carries only the booking reference code (for example `DS-ABC123XYZ`).

## Look
Soft rounded-square modules, rounded corner squares, and the **DINKSLOT logo in the centre** (`assets/icons/qr-logo.png`, embedded into the SVG so the downloaded file works on its own). If the logo cannot be loaded, a plain dot is drawn instead and the code still works.

## Why it was changed
The earlier version drew small round dots (radius 0.42 of a module). Tested with a real scanner (jsQR in a browser), **those codes did not scan at all (0 of 8)**, with or without a logo, even though a plain square code scanned 4 of 4. Dots need to be nearly touching. The final style uses rounded squares (0.94 of a module, corner radius 0.3) and was chosen from these results:

| Style | Scans |
| --- | --- |
| Plain squares | 4 / 4 |
| Round dots, radius 0.42 (old) | 0 / 4 |
| Round dots, radius 0.50 | 7 / 8 |
| **Rounded squares 0.94 (used)** | **8 / 8** |

## Logo size
Error correction is level H (about 30% of the code can be unreadable). The logo area covers about 9% of the code and the modules underneath are left out, so no module is half hidden. Final check: 8 different booking codes scanned correctly **with** the logo and **without** it.

## Tip
Phone cameras are usually more forgiving than the test scanner, but print or show the ticket at least 3 cm wide and scan one real ticket with a phone before relying on it at the door.
