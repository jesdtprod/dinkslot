-- Store only SHA-256 digests of guest access tokens; raw tokens never enter the database.
create table public.guest_booking_access_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  booking_id text not null references public.guest_booking_contacts(booking_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index guest_booking_access_tokens_booking_idx
  on public.guest_booking_access_tokens (booking_id) where revoked_at is null;
alter table public.guest_booking_access_tokens enable row level security;
revoke all on public.guest_booking_access_tokens from public, anon, authenticated;
