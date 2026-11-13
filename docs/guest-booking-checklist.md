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

2026-11-13: A second test booking with a clearly labelled test proof was approved by signed-in club staff. The guest status page displayed Confirmed and a QR pass; the approval email was logged as sent. Test booking, payment and notifications were hidden; the guest contact, tokens and uploaded proof were removed. Email inbox delivery and QR scanning remain to be verified; guest entry remains disabled.

2026-11-13: Guest recovery was submitted through the browser for a temporary booking; the endpoint returned 200 and a new access-token record was created. The booking and notification were hidden and guest contact and tokens removed. The endpoint intentionally returns a generic response, so email delivery and link use were not verified. Database rollback tests and 22 email/token tests passed again; concurrency and registered-player end-to-end tests remain pending.

2026-11-13: Two simultaneous guest reservation requests for the same court and time produced one booking and one slot_taken response. The test booking and notification were hidden, and its guest contact and tokens removed. Registered-player overview, booking countdown and reservation-submit regression scripts passed after updating stale test harnesses; actual signed-in player checkout and email inbox delivery remain unverified.

2026-11-13: A temporary guest booking using a connected test inbox received both the production DINKSLOT booking-received and recovery messages in Inbox. The recovery link opened the correct test booking in the local app. The booking and notification were hidden, and the guest contact and tokens removed. The updated recovery email was then deployed. Signed-in player checkout and approved-email inbox delivery remain unverified.


## Guest My Bookings collection ? 2026-11-13

- [x] Separate hashed, revocable seven-day recovery tokens scoped to a verified booking email; single-booking tokens cannot access the collection.
- [x] RLS enabled and direct public/anon/authenticated table access revoked. Migration 20261113000046 applied to the linked Dink Slot project.
- [x] Paginated collection endpoint (12 per page) with All, Upcoming, Pending, and Past filters across online guest bookings using the same email. No latest-10 history cap.
- [x] Each booking opens the existing details, QR, and payment flow after a fresh email-ownership check. QR remains available only after approval.
- [x] My Bookings page uses the guest workspace design; three desktop columns and one mobile column.
- [x] Browser checks with fixture data: 12-record first page, second page, filters, detail exchange, payment route, and no horizontal overflow at 1440px / 390px.
- [x] Live guest-bookings endpoint: scoped list and filters, invalid-token rejection, unowned booking rejection, owned single-booking exchange, and no contact email exposed. Temporary access tokens removed; no bookings or emails created.
- [x] 29 email/access tests and Deno endpoint type checks passed.
- [ ] Publish the frontend route before deploying recovery emails that link to it.
- [ ] Deploy updated guest-booking-recover and verify its rendered collection email through the production recovery flow with recipient authorization.

Deployment order: migration, guest-bookings and send-booking-email functions, frontend route, then guest-booking-recover. Existing individual booking links continue to work. Recovery mails use one View My Bookings action; existing per-booking notifications remain unchanged apart from the requested subject capitalization. Guest entry remains controlled by the existing localhost feature flag.

Deployment status: migration, guest-bookings, and send-booking-email were deployed. Frontend publish was attempted after commit 79d374a, but GitHub returned 403 (current Git account 19zerocool90 has no write access to jesdtprod/dinkslot). The live frontend still serves app.js v491 / booking.js v502. The updated guest-booking-recover function was deliberately not deployed, so existing recovery emails continue using valid single-booking links. Finish by publishing the committed frontend using an account with repository write access, verify guestBookings is present on the live site, then deploy guest-booking-recover with JWT verification disabled (its own CAPTCHA and token protections apply). No sample email was sent for this change.
