# Guest booking checklist

- [x] Create pre-implementation checkpoint.
- [x] Include the club name in registered-player booking email subjects (code and unit tests; deployment pending).
- [x] Prepare a private guest contact table migration (applied to production; functional testing pending).
- [x] Implement and unit-test token generation and hashing helpers (used by guest reservation; database verification pending).
- [x] Prepare a service-only guest reservation database function using the existing slot, pricing, and hold rules (applied to production; functional testing pending).
- [x] Prepare guest entry, contact form, CAPTCHA verification, reservation endpoint, and per-email request limit (not deployed or end-to-end tested).
- [ ] Test guest reservation rules, concurrent bookings, abuse controls, and idempotency against the database.
- [x] Prepare a private hashed-token storage migration with expiry and revocation fields (applied to production; functional testing pending).
- [x] Implement and unit-test server-side token lookup with expiry and revocation checks (used by guest status and payment endpoints; database verification pending).
- [x] Implement and unit-test server-side token issuance (used by guest emails and recovery; database verification pending).
- [x] Add a token-authenticated guest booking status endpoint (not deployed or database-tested).
- [x] Implement and unit-test server-side token revocation (not exposed or database-tested).
- [ ] Test guest access endpoints and service-role permissions against the database.
- [x] Prepare email-based access-link recovery with CAPTCHA, rate limiting, and non-enumerating responses (not deployed or end-to-end tested).
- [x] Prepare guest-authorized payment proof endpoint and service-only database function (not deployed or database-tested).
- [x] Prepare guest unpaid-hold release endpoint and confirmation action (not deployed or database-tested).
- [x] Prepare guest booking settings and token-authorized payment details endpoint (not deployed or database-tested).
- [x] Connect guest status to the existing checkout and guest-authorized proof upload (not deployed or end-to-end tested).
- [ ] Test guest checkout, refresh, signed QR images, and proof submission end-to-end; verify registered-player flow.
- [x] Add guest booking status page wired to the status endpoint (not deployed or end-to-end tested).
- [x] Render the guest QR pass only for an approved status returned by the endpoint (end-to-end testing pending).
- [x] Prepare tenant-scoped guest email access and display it alongside existing guest contact and payment details in the admin queue (database and end-to-end testing pending).
- [x] Prepare guest status emails and secure booking links using the existing Gmail sender (requires guest creation, migrations, deployment, and delivery tests).
- [ ] Verify registered-player email delivery and status transitions; configure and deploy the webhook and mailer as needed.
- [ ] Run database security, concurrent booking, payment, recovery, accessibility, and end-to-end tests.
- [x] Apply guest booking migrations 37–45 to production and run the database linter.
- [ ] Deploy functions after validation; verify with real delivery and reservation flows.

Validation performed locally: Deno type checks for all guest functions; 21 email/token unit tests; booking, cancellation, navigation and approval regression checks; PostgreSQL parser checks for guest migrations (does not execute PL/pgSQL or enforce policies). Database, storage, CAPTCHA and real email delivery still require a configured Supabase test environment.

Guest booking entry remains disabled by GUEST_BOOKING_ENABLED in js/config.js until the backend is deployed and verified.

2026-11-13: Production migrations 37–45 applied; remote database reports up to date and the public schema linter reported no errors. Guest functions, database behavior and end-to-end flows still require validation before enabling guest booking.

2026-11-13: Guest Edge Functions and updated send-booking-email deployed to production. Invalid-token/request smoke checks returned 401/400 as expected; service-only SQL privileges verified. Guest entry remains disabled. The project has no configured Gmail sender/webhook secrets and no booking webhook Vault entries, so email delivery and the full booking flow have not been tested.

2026-11-13: Production read-only smoke checks verified anonymous users can retrieve booking limits without payment details; unknown guest tokens cannot retrieve booking status, release holds, or obtain payment details. Database inspection confirmed RLS and no direct anon/authenticated SELECT on guest contacts, access tokens, or attempt records. Valid-token operations, concurrency and full payment/email flows remain untested.

2026-11-13: Gmail sender credentials and booking webhook Vault entries configured. The webhook authenticated successfully in a no-email smoke test, and a temporary protected OAuth probe confirmed the refresh token can obtain an access token; the probe was removed. Actual email delivery and end-to-end guest booking remain untested; guest entry remains disabled.

2026-11-13: An explicitly authorized test email to the configured sender was accepted by Gmail. The first database-to-function request timed out during DNS resolution; a retry with a longer timeout succeeded. Inbox receipt and booking-triggered delivery still require confirmation.

2026-11-13: A production database transaction tested guest creation, idempotent retry, token-scoped payment information, unpaid-hold release, proof attachment, and rejection of release after proof. The transaction was rolled back; no test contacts remained. Concurrent requests, real image upload, human verification, live guest emails, and browser flow remain untested.

2026-11-13: An authorized temporary guest booking at The Pickleshot created a staff notification; the email log recorded both booking-received and booking-request messages as sent. The unpaid hold was released, the booking and its notifications were hidden, and its guest contact and access token were removed. This backend test bypassed the browser and CAPTCHA; inbox delivery, real proof upload, and the full guest flow still require verification. Guest entry remains disabled.

2026-11-13: A locally enabled guest browser flow completed Turnstile, selected a court slot, created a temporary production booking, and uploaded an image labelled TEST ONLY through checkout. Staff booking and proof notifications were recorded; booking-received and booking-request emails were logged as sent. The test booking, payment and notifications were hidden, its guest contact and access tokens removed, and its uploaded image deleted. Authenticated staff approval, approved-email inbox delivery, and guest QR verification remain untested. The public guest feature remains disabled.
