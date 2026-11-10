# Player accounts and club accounts

Two separate registrations, enforced in Postgres (migration `...0016`), not just by the screens.

| | Player account | Club (tenant) account |
| --- | --- | --- |
| Sign up | Sign up / Sign in with Google, or "Sign up to book" on a club page | `Register your club` (`/#/register-club`): its own club sign-up, then club details |
| Can do | join clubs, book courts, pay by QR, My bookings | run one club: courts, settings, staff, approve bookings, book for customers |
| Cannot do | register a club, be club staff | join a club or book as a player |

`profiles.account_type` is `player`, `tenant` or empty (not chosen yet, for example a first Google sign-in). It is set from the sign-up page (`account_type` in the sign-up data), or the first time the person acts (`join_club` makes a player, `register_club` makes a club account), or through `choose_account_type()` after a Google redirect. Once set it cannot be changed by the user. Staff are club accounts: the owner adds an existing, confirmed club account by email.

What the database refuses:
- `register_club` from a player account (`player_account_cannot_register_club`); a second club for the same account (`already_has_club`).
- `join_club` / any `club_players` row for a club account (`club_account_cannot_book`), including via `admin_add_player`.
- `add_staff` for a player account (`user_is_player`) or someone who already manages another club (`user_in_other_club`).

## Club books for customers
Owner or staff: Dashboard > Bookings > **Book for a customer**.
- **Walk-in guest**: name (and optional phone). Stored as a booking with `source = walk_in`, no account needed.
- **Registered player**: choose from the club's players, or add an existing player account by email (`admin_add_player`; the player is notified). Stored with `source = admin`; the player sees it in My bookings, gets a notification and a confirmation email.
- Approved immediately (the club handles payment itself), same slot grid, opening hours, blocks and no-overlap rules as online bookings (`create_admin_booking`). Retry-safe with an idempotency key. The club can cancel it like any booking (reason required).
- Club-made bookings do not send "new booking" alerts to the club's own admins.

## Players must register to book
Visitors see **Sign up to book**; booking links send them to "Register to book at <club>"; after sign-up, email confirmation or Google they are joined to the club and land on the booking page. `create_booking` requires a signed-in player who joined the club.

## Verification
Isolation and flow test: 217 checks, 0 failures, including: account type from sign-up data, player cannot register a club, club account cannot join or book, player cannot be staff, type cannot be switched or edited, guest and player bookings by the club (grid, hours, overlap, blocks, retry, other club's court refused, players and anonymous refused), guest bookings hidden from players, added player notified. Email rules: 11 offline tests.

## Player dashboard
Players have their own dashboard at `/#/me` (js/player.js), in the same sidebar layout as the club dashboard but labelled "Player Workspace":
- **Overview**: confirmed upcoming bookings, bookings waiting for payment or approval, clubs joined, next booking.
- **Find a club**: search all approved clubs; **Join and book** or **Book a court** (if already joined).
- **My clubs**: the clubs the player joined, with Book buttons.
- **My bookings**: pay and upload proof, cancel, history (live).
- **My profile**: name and phone.
There is no "Clubs you manage" or "Register your club" for players. Club registration is a separate club account.

## Signed-in people skip the entry pages
When signed in, `/auth` (sign in and sign up) always redirects to the person's own home: super admin `/platform`, club owner or staff their dashboard, a club account that has not added its club yet `/register-club`, a player `/me`. A player who opens `/register-club` is sent to their dashboard with a notice that a separate club account is needed; a club owner is sent to their dashboard. The top bar already hides Sign in, Sign up and Register your club once signed in.
