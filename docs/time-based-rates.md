# Time-based rates (rate bands)

A **rate band** is: days + time range + hourly rate. Example: every day 6:00 AM - 6:00 PM = PHP 150/hr, every day 6:00 PM - midnight = PHP 200/hr.

Where to set them (Dashboard > Courts):
- **Club-wide Pricing Schedule** (its own panel): applies to every court that has no bands of its own.
- **Edit court > Time-based rates for this court**: applies to that court only and overrides the club-wide bands.

Days: **Every day**, **Weekdays (Mon - Fri)** or **Weekends (Sat - Sun)**, in the club's timezone. "To" = 12:00 AM means midnight.

## Which rate is charged
First match wins:
1. this court, weekday/weekend band
2. this court, every-day band
3. club-wide, weekday/weekend band
4. club-wide, every-day band
5. the court's own **Hourly Rate** (used when no band covers the time, and by courts with no bands at all)

Nothing changes for a club that adds no bands.

## How a booking is priced
Each slot is charged at the rate in force when the slot **starts**. A 5 PM - 7 PM booking with the example above costs 150 + 200 = PHP 350. The total is stored in `bookings.amount`, so QR payment, proofs, reports and tickets are unchanged.

The price is calculated in the database (`court_price`, used by `create_booking` and `create_admin_booking`), never by the browser. The booking screen shows each slot's rate and a preview total from `court_slot_rates`, which uses the same function.

## Rules
- Bands for the same court (or the club) and the same days cannot overlap. A weekday band and an every-day band may cover the same hours (the weekday band wins on weekdays).
- Public cards show "PHP 150 - 200/hr" (cheapest to dearest across a week).
- Holidays and special dates are not supported yet.

Migration: `20261110000024_time_based_rates.sql`. Tests: the "Rates:" block in `supabase/tests/isolation_test.sql`.
