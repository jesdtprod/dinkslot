# Runbook: backups, restore, secrets

## What needs protecting
| Data | Where | Backed up by |
| --- | --- | --- |
| Database (clubs, players, bookings, proofs metadata, audit) | Supabase Postgres | `scripts/db-backup.mjs`, plus Supabase plan backups |
| Files (club photos, payment QR codes, payment proofs) | Supabase Storage buckets `club-media`, `payment` | `supabase storage cp` (below) |
| Schema and functions | `supabase/migrations/` in git | git |
| Edge Functions | `supabase/functions/` in git | git |
| Secrets | Supabase Edge secrets and Vault | you (see "Secrets" below); they are not in git |

Supabase's own backups: the Free plan has none. Pro keeps daily backups and can add point-in-time recovery. **For a real pilot, use Pro.** The scripts below are an independent copy you control.

## Backup (database)
    node scripts/db-backup.mjs backup            # writes backups/<timestamp>/ with a manifest of row counts and sha256 checksums

A backup contains personal data (emails, password hashes, payer references). `backups/` is git-ignored; store copies somewhere private and encrypted.

## Backup (files)
    npx supabase storage cp -r --remote --experimental ss:///club-media backups/storage/club-media
    npx supabase storage cp -r --remote --experimental ss:///payment    backups/storage/payment

Listing was tested against this project (`npx supabase storage ls --remote --experimental ss:///`). Copying has not been exercised yet because no files have been uploaded.

## Prove a backup is good (restore test)
    node scripts/db-backup.mjs verify backups/<timestamp>

It checks every file against its checksum, restores all tables into a throwaway schema inside a transaction, compares row counts and a checksum of the data with the live tables, then rolls everything back. Exit code 0 means every table matched. A damaged or edited backup is rejected before anything is restored. Last run (11 Nov 2026): 15 of 15 tables match; a tampered file was rejected.

Run it after every backup, and at least before each launch step.

## Restore into a fresh project
Use this if the project is lost or corrupted. Restore into a **new, empty** Supabase project, never on top of live data.

1. Create the new project. `npx supabase login`, then `npx supabase link --project-ref <new ref>`.
2. Update `js/config.js` (project URL, anon key) and `scripts/setup-email.ps1` / the Turnstile and Auth settings for the new ref.
3. Schema: `npx supabase db push --remote` (applies every migration in order).
4. Data: `DINKSLOT_RESTORE_CONFIRM=<new ref> node scripts/db-backup.mjs restore backups/<timestamp> --apply`. It refuses unless the project is empty and the confirm variable matches. It disables the notification, email and rate-limit triggers while loading history, so restored bookings do not send emails or notifications.
5. Files: copy the saved folders back with `npx supabase storage cp -r --experimental backups/storage/<bucket> ss:///<bucket> --remote`.
6. Secrets (section below), then deploy functions: `npx supabase functions deploy verify-turnstile --use-api` and `send-booking-email --use-api`.
7. Auth settings (Turnstile captcha, site URL, redirect URLs): re-apply as in `docs/stage3.md`.
8. Smoke test: sign in, open a club, create a booking in a test club.

The restore step itself (step 4) has only been rehearsed through the verify test, not run into a second project, because only one project exists. Rehearse it once into a scratch project before you rely on it.

## Secrets
Edge secrets (`npx supabase secrets list`): `TURNSTILE_SECRET_KEY`, `WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, optional `SITE_URL`, `EMAIL_DRY_RUN`.
Vault (SQL, `select name from vault.secrets`): `edge_base_url`, `edge_anon_key`, `booking_webhook_secret`.

To rotate the webhook secret, re-run `scripts/setup-email.ps1`; it updates both places. Rotate the Turnstile secret in Cloudflare, then `npx supabase secrets set TURNSTILE_SECRET_KEY=...` and update the Auth captcha secret. If the Gmail refresh token is revoked, redo `docs/gmail-setup.md` step 3.

Never put the service role key, Turnstile secret, Gmail credentials or any `.env` in the repo. Only the project URL, the anon key and the Turnstile **site** key may be public.

## When something breaks
- Players cannot sign up or sign in: Cloudflare Turnstile widget hostnames (must include the live site), the Auth captcha setting, Supabase email limits.
- "You are doing that too often": the per-user rate limits in `docs/stage8.md`; they reset on a rolling hour (day for club registration).
- Emails not arriving: `select * from email_log order by created_at desc limit 20;` (status `failed` shows the error), then the Edge Function logs in the Supabase dashboard.
- Booking looks stuck: `select cron.job.jobname, cron.job_run_details.status, cron.job_run_details.start_time from cron.job_run_details join cron.job using (jobid) order by start_time desc limit 10;` (the expiry job runs every minute).
