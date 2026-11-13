-- Email-wide access is separate from single-booking links and is issued only
-- through CAPTCHA-protected email recovery. Raw tokens are never stored.
create table public.guest_booking_collection_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
alter table public.guest_booking_collection_tokens enable row level security;
revoke all on public.guest_booking_collection_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.guest_booking_collection_tokens to service_role;
create index guest_booking_contacts_email_idx on public.guest_booking_contacts (email);
