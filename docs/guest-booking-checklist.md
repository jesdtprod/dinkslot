# Guest booking checklist

- [x] Create pre-implementation checkpoint.
- [x] Include the club name in registered-player booking email subjects (code and unit tests; deployment pending).
- [x] Prepare a private guest contact table migration (not applied or database-tested).
- [x] Implement and unit-test token generation and hashing helpers (used by guest reservation; database verification pending).
- [x] Prepare a service-only guest reservation database function using the existing slot, pricing, and hold rules (not applied or database-tested).
- [x] Prepare guest entry, contact form, CAPTCHA verification, reservation endpoint, and per-email request limit (not deployed or end-to-end tested).
- [ ] Test guest reservation rules, concurrent bookings, abuse controls, and idempotency against the database.
- [x] Prepare a private hashed-token storage migration with expiry and revocation fields (not applied or database-tested).
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
- [ ] Apply migrations and deploy functions after validation; verify with real delivery and reservation flows.

Validation performed locally: Deno type checks for all guest functions; 21 email/token unit tests; booking, cancellation, navigation and approval regression checks; PostgreSQL parser checks for guest migrations (does not execute PL/pgSQL or enforce policies). Database, storage, CAPTCHA and real email delivery still require a configured Supabase test environment.

Guest booking entry remains disabled by GUEST_BOOKING_ENABLED in js/config.js until the backend is deployed and verified.
