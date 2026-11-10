# Stage 6: booking flow

## Screens (js/booking.js)
| Where | Who | What |
| --- | --- | --- |
| `/#/c/<slug>/book` | joined player | choose court, date, start slot and length; taken/past slots greyed; amount; Reserve; then QR + instructions + reference code + hold countdown + proof upload |
| `/#/me` > My bookings | player | upcoming and history, status, cancel, "Pay and upload proof", rejection reason, live updates |
| `/#/admin/<slug>` | owner, staff | approval queue with proof viewer (Approve / Reject with reason), today's bookings, upcoming bookings (Cancel with reason), live updates |

Players who have not joined the club are sent to the join page first, then back to booking.

## Rules enforced by the database (not the browser)
`create_booking` (slot grid, opening hours, window, min/max hours, blocks, price from the court rate, no overlap), `attach_payment_proof` (proof path must be `<tenant>/proofs/<user>/...`, one payer reference per club), `decide_booking` (owner/staff only, proof required when payment is on, reason required to reject), `cancel_booking` (player until the cutoff, admin any time with a reason), `expire_pending_bookings` (`pg_cron`, every minute).

Retry safety: the browser keeps one idempotency key per selection, so a double click or a retry returns the original booking.

## Realtime
`bookings` and `notifications` are in the Realtime publication (migration `...0012`). RLS decides who receives what; polling every 20 s is the fallback.

## Verification
Isolation and flow test: 159 checks, 0 failures. Stage 6 additions: player cancel (and retry), rebooking a cancelled slot, admin cancel needs a reason and the player sees it, expiry through `expire_pending_bookings` (and clients cannot call it), expired slot is bookable again, expiry notification, cancel blocked inside the cutoff for players but allowed for the club admin. Earlier checks already cover create, approve, reject and retried idempotency keys.

## UI redesign (sidebar dashboards, public pages)
- `js/ui.js`: `DS.ui.dash()` renders the sidebar dashboard shell (club dashboard and super admin console).
- Club dashboard routes: `/#/admin/<slug>` (overview), `/bookings`, `/courts`, `/profile`, `/payments`, `/staff` (owner-only sections hidden from staff). `/settings` still works and opens the profile.
- Super admin console: sidebar by status (pending, approved, rejected, suspended, all) with live counts.
- Public pages: landing (hero search, club cards with price and court count), club page (banner, logo, chips, court cards), My account (profile editor, clubs, bookings).
- Tailwind's reset strips default heading, list and link styles, so `css/app.css` defines a scoped typography base for app-built pages. The auth screen is untouched.
