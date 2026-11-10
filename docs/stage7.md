# Stage 7: notifications

## In-app (live)
- `js/notify.js`: bell in the top bar (players, club admins and the super admin), unread badge, dropdown with readable messages, "Mark all read", click to open the right screen, and a toast when a new notification arrives.
- Source: `public.notifications` (a user sees only their own rows). New rows arrive through Realtime, with a 60 s poll as fallback. Clients can only set `read_at`; they cannot create or edit notifications.
- Who is notified: player (received, approved, rejected, cancelled by club, expired), club owner and staff (new request, proof uploaded, player cancelled, staff added, club approved/rejected/suspended), super admin (new club registered; trigger in migration `...0013`).

## Email (built; needs your Gmail credentials to send)
Flow: `bookings` insert or status change -> trigger `booking_email_webhook` -> `pg_net` POST -> Edge Function `send-booking-email` -> Gmail API -> `email_log`.

| Event | Email |
| --- | --- |
| booking created (pending) | player: received; each club owner/staff: new request |
| approved | player (admins too when it was auto-approved) |
| rejected | player, with the reason |
| cancelled | player, with the reason; admins too when the player cancelled |
| expired | player |

Design rules:
- The browser never calls the function. The trigger sends the shared secret (`x-webhook-secret`) and the public anon key as the Bearer token, so Supabase JWT verification stays **on** and the function checks the secret as well.
- The function re-reads the booking, club, court and people from the database; it ignores the webhook body for content.
- Idempotency: `email_log` has a unique index on (`idempotency_key`, `to_address`) with key `booking_id:status`. The function claims the row first, so a replayed webhook sends nothing new.
- From name is the club name, Reply-To is the club's contact email.
- If email is not configured the function returns `skipped` and logs nothing, so mail starts flowing as soon as credentials exist. A failed send is recorded in `email_log` (`status = failed`, `error`).
- The trigger swallows its own errors: a booking never fails because of email.
- Swappable provider: `Mailer` interface in `index.ts` (Gmail now, Resend later).

Secrets live in Supabase only: Edge secrets (`WEBHOOK_SECRET`, `GMAIL_*`, optional `SITE_URL`, `EMAIL_DRY_RUN`) and Vault (`edge_base_url`, `edge_anon_key`, `booking_webhook_secret`). Setup: `scripts/setup-email.ps1`, credentials: `docs/gmail-setup.md`.

## Verification
- `isolation_test.sql`: 167 checks, 0 failures (adds super admin new-club notice, no cross-club notifications, mark-read own rows only, no forging or editing notifications).
- `deno test supabase/functions/send-booking-email/lib_test.ts`: 10 tests, 0 failures (recipients per event, one mail per admin, reason included, HTML escaping, club timezone, MIME encoding and header-injection safety, secret comparison).
- Not yet verified end to end: a real email arriving once and a replayed webhook sending nothing. That needs the setup script run once (dry run is enough to check `email_log` and replay behaviour).

## Account page removed for club owners and staff
Anyone who manages a club is sent straight to their dashboard: `/#/me` redirects to `/#/admin/<slug>`, the top bar says **Dashboard**, and the new-club confirmation links to the dashboard. The personal profile (name, phone) and the user's own player bookings live in the dashboard sidebar under **My profile** (`/#/admin/<slug>/account`). Players who manage no club still use `/#/me`. A club owner waiting for approval sees the status update on the dashboard by itself (Realtime on the club row).
