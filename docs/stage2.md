# Stage 2: schema and security

Migrations (`supabase/migrations/`), applied to project `achwxeisrakxdtzmfbrc`:

| File | Contents |
| --- | --- |
| `...0001_foundation_tables.sql` | `gen_ulid()`, all 12 tables, soft delete, `updated_at` triggers, hard-delete blocker, no-overlap exclusion constraint |
| `...0002_rls_policies.sql` | RLS enabled and forced on every table, access helpers, column-level grants, `public_clubs` and `public_courts` views |
| `...0003_functions.sql` | `register_club`, `decide_club`, `join_club`, `court_availability`, `get_booking_info`, `create_booking`, `attach_payment_proof`, `decide_booking`, `cancel_booking`, `expire_pending_bookings` |
| `...0004_storage.sql` | Buckets `club-media` (public) and `payment` (private), 5 MB, JPG/PNG/WebP, path-based policies |
| `...0005_cron.sql` | `pg_cron` job expiring unpaid pending bookings every minute |
| `...0006_grant_gen_ulid.sql` | Execute grant on `gen_ulid()` (found by the isolation test) |

## Isolation model
- Clients get no write access to `bookings`, `booking_payments`, `email_log`, `audit_log`, `tenant_members`; they call functions.
- Direct writes are limited by column grants + RLS (club profile, settings, courts, blocks, own profile).
- Cross-tenant composite foreign keys `(court_id, tenant_id)` and `(player_id, tenant_id)` stop a row pointing at another club's data.
- Anonymous users read only `public_clubs`, `public_courts` and `court_availability` (court_id, starts_at, ends_at).
- Storage: `<tenant_id>/qr/*` and `<tenant_id>/proofs/<user_id>/*` in `payment`; first path segment checked against membership.

## Isolation test
`supabase/tests/run-isolation.ps1` runs `isolation_test.sql` as real users (set local role + JWT claims) inside a transaction that rolls back. Result: **108 passed, 0 failed**, including cross-club select/update/delete/insert on every table, `decide_booking` and `cancel_booking` on another club's booking, storage reads and writes, anonymous visibility, double-booking rejection, and idempotent retries.

## Known notes
- Staff management (adding `tenant_members`) has no client write path yet; planned for Stage 5.
- Turnstile verification is wired in Stage 3.
