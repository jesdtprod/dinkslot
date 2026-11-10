# Payment methods (several QR codes)

A club can add up to **8 payment QR codes** (GCash, Maya, bank...), each with a label, optional account name and number, and an **Active / Inactive** switch.

## Owner: Dashboard > Payments and rules > Payment methods
- **Add** a method: label (required), account name and number (optional), QR image (JPG, PNG or WebP, 5 MB).
- **Active switch**: players see only active methods. Switching off hides it at once without deleting it.
- **Save details**, **Replace image** and **Delete** per method. Delete is a soft delete (the row is kept for the audit trail; the image is removed).
- Overview checklist: "Payment QR code" is done when at least one method is active (or payment is turned off).
- A court's own QR (Courts page) still works: it is offered first as "Court QR".
- The old single QR was moved into the list automatically (none existed yet in this project).

## Player: checkout
At payment the player sees tabs, one per active method, with the QR, account name and number. They pay with one, upload the proof and the payer reference; the method they chose is saved with the proof. If the club has no active QR the player is told to contact the club.

## Club: approval queue
The proof viewer line shows the payer reference and **via <method>** so the club knows which account to check.

## Database (migration `...0018`)
- `payment_qrs`: forced RLS. Only the club owner reads, adds and edits (staff cannot); players cannot read the table. `qr_path` must sit under `<tenant_id>/qr/` and cannot contain `..`.
- `get_booking_info()` returns the active methods to a player who joined the club (and nothing when payment is off).
- `delete_payment_qr()` soft deletes; `booking_payments.method` stores the method label; `attach_payment_proof` takes an optional `p_method`.
- Files: private `payment` bucket under `<tenant_id>/qr/` (existing storage policies: club admins write, joined players read).

## Verification
Isolation and flow test: 248 checks, 0 failures. New: owner adds and switches QR codes; players see only the active ones and never read the table; staff and other clubs' owners cannot add, switch, see or delete; path checks; nothing is offered when payment is off; anonymous and non-members are refused.
