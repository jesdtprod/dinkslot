-- Guest contact information is kept separately from publicly accessible booking data.
-- Guest booking and recovery endpoints will access it only through server-side functions.
create table public.guest_booking_contacts (
  booking_id text primary key references public.bookings(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now()
);

alter table public.guest_booking_contacts enable row level security;
revoke all on public.guest_booking_contacts from public, anon, authenticated;
