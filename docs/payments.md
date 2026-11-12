# Payment methods (QR cards)

## Pickleshot sample data

`assets/sample-payments/` contains scannable GCash, Maya, and bank demo QR images. Each encodes an explicit **SAMPLE ONLY / NOT VALID FOR PAYMENT** message, not a payment destination.

On The Pickleshot's Payments and rules page, empty cards offer **Add sample data and QR**. This saves a labeled sample account and QR using the signed-in owner's permissions, keeping the card inactive. Activate a saved card with its switch; the tab and overall active counts update after the database confirms the change. Existing accounts are preserved.

The page also initializes untouched Pickleshot slots with sample details and QR images on the first visit, including all Maya and bank slots. It uses the signed-in owner's storage and database permissions, preserves configured cards, and leaves samples inactive. A browser-local completion marker prevents automatically refilling cards cleared afterward in that browser. Failed setup displays an error and can resume on refresh.

To populate The Pickleshot's empty payment cards, set `SUPABASE_SERVICE_ROLE_KEY` in your local environment and run `node scripts/seed-pickleshot-payments.mjs`. The script targets only `the-pickleshot`, preserves existing card details, fills empty slots with labeled sample accounts, and keeps samples inactive. It adds sample payment instructions only if blank and preserves existing checkout switches and booking rules. Running it again preserves previously populated cards. Never commit the service role key.

Every club has **9 ready-made payment cards: 3 GCash, 3 Maya and 3 Bank account**. One card = one account. All start **inactive**. The owner fills a card in, uploads its QR and switches it on. (Clubs created later get their 9 cards automatically; existing clubs were given theirs.)

## Owner: Dashboard > Payments and rules
The page has three sections and one Save button:
1. **Checkout**: pay-by-QR switch, "I approve every booking myself" switch, and the payment instructions (full width).
2. **Payment methods (QR codes)**: the nine cards, shown as three tabs (GCash, Maya, Bank account), three cards per tab, with an "N of 9 active" counter and "x / 3 active" on each tab. The cards sit outside the settings form, so pressing Enter in a card never saves the settings; each card saves on its own.
3. **Booking rules**: days ahead, minimum and maximum hours, cancellation cutoff, hold time.
**Save settings** saves sections 1 and 3 (maximum hours must be at least the minimum).

### The cards
- Each card has: label players see (default "GCash 1"), account name, mobile number (GCash/Maya) or bank and account number (Bank), the QR image, and an **Active / Inactive** switch.
- **The switch stays off until the card has a QR image**; a card cannot be active without one (enforced by the database).
- **Check on upload:** when a file is chosen, the browser scans it. "QR code detected" lets you save; "No QR code found in this image" blocks saving. Uses the browser's `BarcodeDetector` when it has one, otherwise the small jsQR library (loaded on demand, 10 s time limit). If the scanner cannot load, you may still save, with a clear warning.
- **Save card**, **Clear card** (empties the details, deletes the image, switches it off). After every action a message confirms what happened ("Saved GCash - Juan. QR code checked. Switch the card on to show it to players.").
- Cards cannot be added or removed: the 9 slots are fixed. A card's type and slot cannot be changed.
- Overview checklist: "Payment QR code" is done when at least one card is active (or payment is turned off).
- A court's own QR (Courts page) still works and is offered first as "Court QR".
- The checker confirms the image contains *a* QR code, not that the payment account is correct. Test each QR with a real payment before going live.

## Player: checkout
Tabs show only the **active** cards (GCash first, then Maya, then Bank). The player pays with one, uploads proof and the payer reference, and the card they used is saved with the proof. If no card is active the player is told to contact the club.

## Club: approval queue
The proof line shows the payer reference and **via <card label>**.

## Database (migrations `...0018`, `...0019`, `...0020`)
- `payment_qrs`: forced RLS; only the club owner reads and edits (staff cannot); players cannot read the table, they get the active cards through `get_booking_info()`.
- 9 fixed rows per club (`kind` gcash/maya/bank, `slot` 1 to 3, unique); nobody can insert or delete rows; `kind` and `slot` cannot change.
- `qr_path` is null until uploaded; it must sit under `<tenant_id>/qr/` with no `..`; `is_active` requires a `qr_path`.
- `clear_payment_qr()` empties a card and returns the old path so the browser can delete the file; `booking_payments.method` stores the card label used.
- Files: private `payment` bucket under `<tenant_id>/qr/` (club admins write, joined players read).

## Verification
- Isolation and flow test: **258 checks, 0 failures** (9 cards per club, 3/3/3 split, all start inactive, cannot activate without an image, setup and switching, players see only active cards in type order, cannot read the table, no 10th card, type/slot locked, staff and other clubs refused, path checks, clear resets the card, payment off hides all cards, anonymous and non-members refused). Both real clubs now have 9 inactive cards.
- QR scanner in a real browser: a QR image is detected, a big phone-style screenshot with a small QR is detected, the DINKSLOT logo is rejected.
