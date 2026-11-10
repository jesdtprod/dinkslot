# Stage 4 and 5: landing, club page and club dashboard

## Screens
| Route | Who | What |
| --- | --- | --- |
| `/#/` | everyone | approved clubs grid, search, city filter |
| `/#/c/<slug>` | everyone | cover, profile photo, description, address, courts and rates |
| `/#/admin/<slug>` | owner, staff | setup checklist, approval queue placeholder (Stage 6) |
| `/#/admin/<slug>/courts` | owner, staff | add/edit/delete courts, rate, hours, slot length, maintenance, optional court QR, blocked times |
| `/#/admin/<slug>/settings` | owner only | club profile, cover and profile photos, payment QR and instructions, payment on/off, approval rule, booking window, min/max hours, cancel cutoff, hold time, staff |

Dashboard code: `js/admin.js` (loaded after `js/app.js`, uses `window.DS`).

## Database additions
- `...0010` `add_staff`, `remove_staff`, `list_tenant_staff` (owner only; staff must have a confirmed account).
- `...0011` `delete_court`, `delete_court_block` (soft delete through functions; a court with upcoming bookings cannot be deleted). `deleted_at` is no longer directly updatable by clients.
- `...0009` Realtime on `tenants` (owner sees approval status live).

## Storage layout
- `club-media/<tenant_id>/logo-<ts>.<ext>`, `cover-<ts>.<ext>` (public read, club admins write)
- `payment/<tenant_id>/qr/club-<ts>.<ext>`, `court-<ts>.<ext>` (private)
- Images: JPG, PNG, WebP, 5 MB max (enforced by the bucket and checked in the browser).

## Verification
Isolation test: 144 checks, 0 failures. New checks cover a club admin editing only their own club, owner-only staff actions, staff access rules, removal of access, soft-delete functions and storage writes to the own club only.
