# Launch checklist (pilot with one real club)

Tick each item. Items marked **you** need something only you can do.

## 1. Publish
- [ ] **you** `git push origin main` as `jesdtprod`; GitHub > Settings > Pages > branch `main`, folder `/ (root)`.
- [ ] Open `https://jesdtprod.github.io/dinkslot/`: home loads, club cards appear, favicon shows.
- [ ] **you** Cloudflare Turnstile widget lists `jesdtprod.github.io` (and `localhost` for testing). Use the real site key and secret (not the test keys).
- [ ] Supabase Auth: Site URL is `https://jesdtprod.github.io/dinkslot/` and it is in the redirect allow list.
- [ ] Hard-refresh, then install the app to the phone home screen once; check the icon and name.

## 2. Accounts and email
- [ ] **you** Supabase Auth email: the built-in sender allows only a few emails an hour, which blocks real sign-ups. Set a custom SMTP sender under Authentication > Emails (SMTP is fine for Auth emails; it only fails from Edge Functions).
- [ ] **you** Gmail API credentials and `scripts/setup-email.ps1` (see `docs/gmail-setup.md`). First run with `-DryRun`, check `email_log`, then turn dry run off.
- [ ] Super admin `dinkslot2026@gmail.com` can sign in and sees the Platform console.

## 3. Plan and backups
- [ ] **you** Supabase plan: Pro for the pilot (daily backups, no pausing). Free projects pause after a week of no use.
- [ ] `node scripts/db-backup.mjs backup` then `... verify <dir>` shows every table MATCH. Store the copy privately.
- [ ] Storage files backed up (`docs/runbook.md`).
- [ ] Rehearse the restore into a scratch project once.

## 4. Security spot checks (all verified, re-run after any schema change)
- [ ] `powershell -File supabase/tests/run-isolation.ps1`: 0 failures.
- [ ] `deno test supabase/functions/send-booking-email/lib_test.ts`: 0 failures.
- [ ] No secrets in the repo (scan in `docs/stage8.md`).
- [ ] Rate limits active (`docs/stage8.md`).

## 5. Pilot club walk-through (do it with the club owner on their phone)
1. Owner registers, super admin approves, owner sees the live status change.
2. Owner sets profile photos, one court, payment QR and instructions.
3. A friend joins the club, books a slot, pays by QR, uploads proof.
4. Owner approves; friend sees it confirmed; both got the in-app notification (and email, once configured).
5. Friend cancels a booking before the cutoff; an unpaid booking expires after the hold time.
6. Owner blocks a time; the slot shows greyed out for players.

## 6. Go / no-go
Launch when sections 1 to 4 are ticked and the walk-through in 5 completed once with no errors. Keep the first week small (one club, a few players) and check `email_log`, the Supabase logs and the rate-limit messages daily.
