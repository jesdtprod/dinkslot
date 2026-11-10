# Stage 8: hardening and launch

## Rate limits (database)
Per-user limits on writes, enforced by `BEFORE` triggers in Postgres (migration `...0015`), so they also cover direct table writes and need no function changes. Counters live in a private table (`rate_limits`, no client access) and expired rows are purged by `pg_cron` every 15 minutes. Only signed-in end users are limited; the service role and migrations are not.

| Action | Limit |
| --- | --- |
| Create a booking | 30 per hour |
| Upload payment proof | 30 per hour |
| Cancel bookings | 30 per hour |
| Approve or reject bookings | 300 per hour |
| Join clubs | 10 per hour |
| Register clubs | 5 per day |
| Add staff | 30 per hour |
| Create courts / blocks | 60 / 100 per hour |
| CAPTCHA passes (Edge Function) | 5 per hour |

The error is `rate_limited`, shown as "You are doing that too often". A failed attempt rolls its own counter back, so the limits count successful writes; abuse by cheap failing calls is bounded by Supabase's API limits. Sign-in and sign-up are also protected by Turnstile and Supabase Auth's built-in limits.

## Error pages and offline
- Friendly 404 and "Something went wrong" pages with Try again and Back to home (`DS.ui.errorPage`). A failed request shows a plain message ("Cannot reach the server...") and any unhandled error raises a toast, so nothing fails silently.
- Offline banner: shown when the browser goes offline, with a "Back online" toast when it returns.
- Service worker: the app shell, scripts and images are cached; the third-party libraries, Tailwind and fonts are cached after the first visit, so the shell opens offline. Our own files load network-first so a deploy shows up straight away. Supabase calls and the human check are never cached, so booking and sign-in need a connection.

## Backup and restore
`scripts/db-backup.mjs` (no Docker needed): `backup`, `verify`, `restore`. See `docs/runbook.md`.

## Verification
- Isolation and flow test: **182 checks, 0 failures** (adds the limiter: third call refused, clients cannot call or read counters, a sixth club in a day refused; all earlier flows still pass, so no limit is hit by normal use).
- Backup test on the live project: 15 of 15 tables restored into a throwaway schema and matched on row count and data checksum; a tampered backup file was rejected; the throwaway schema was confirmed gone afterwards.
- Secret scan: the only key in the repo is the public anon key (role `anon`); no service role key, Turnstile secret or Gmail credential; no `.env` or backup files tracked.
- 404 page rendered and checked in a browser.

## Not verified yet (needs you)
- The live site on GitHub Pages (nothing is pushed yet) and the real Turnstile hostnames.
- A real email arriving once and a replayed webhook sending nothing (needs Gmail credentials).
- A restore into a second Supabase project (rehearsal), and file backups with real uploads.
- The pilot walk-through with a real club: `docs/launch-checklist.md`.

## Register before booking
Players need an account, and a profile at the club, before they can book:
- Club page and court cards show **Sign up to book** to visitors (and a small "Already registered? Sign in" link); signed-in players see **Book**.
- Opening a booking link while signed out redirects to `/#/auth?mode=up&join=<club>&next=/c/<club>/book`, which reads "Register to book at <club>".
- After sign-up or sign-in the player joins the club (`join_club`) and lands on the booking page. If email confirmation (or Google sign-in) interrupts the flow, the intent is remembered in the browser for 24 hours and finished as soon as they are signed in.
- The database enforces this regardless of the screens: `create_booking` needs a signed-in user who joined the club, and anonymous callers are refused (covered by the isolation test).
