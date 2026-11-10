# Court opening hours, midnight and 24 hours

Each court has an opening and a closing time (Dashboard > Courts). Times are in the club's timezone.

| Setting | Meaning |
| --- | --- |
| Opens 06:00, closes 10:00 PM | 6 AM to 10 PM. Last hourly slot 9 PM to 10 PM. |
| Opens 06:00, closes **12:00 AM** | 6 AM to **midnight**. Last hourly slot 11 PM to 12 AM. |
| Opens 12:00 AM, closes 12:00 AM | **Open 24 hours** (24 hourly slots). |

A closing time of `00:00` is stored as the END of the day (24:00). The Closes field says "(12:00 AM = midnight)" and the court list, the club page and the booking screen show "06:00 - midnight" or "Open 24 hours".

Rules (enforced in the database, migration `...0021`):
- A booking may end exactly at midnight but cannot run past it. There are no overnight bookings; a club that works through the night uses the 24-hour setting and books within each day.
- Opening hours are still checked: a slot starting before opening or ending after closing is refused. The slot grid starts at the opening time.
- A closing time earlier than the opening time (other than midnight) is refused.
- Applies to player bookings (`create_booking`) and to bookings made by the club (`create_admin_booking`).

Not supported: a court that opens in the evening and closes after midnight (for example 6 PM to 2 AM). Split it by using the 24-hour setting, or tell me and it can be added.

## Verification
Isolation and flow test: 269 checks, 0 failures. New: close before open refused; a court closing at midnight accepts the 11 PM to 12 AM slot, refuses 11 PM to 1 AM and a start at midnight; the midnight slot shows as taken to others; the club can book it; a 24-hour court accepts a 2 AM slot; going back to 10 PM closing refuses 10 PM to 11 PM again. Slot counts checked: 06:00-midnight gives 18 hourly slots, 24 hours gives 24.
