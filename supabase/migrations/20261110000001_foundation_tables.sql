-- DINKSLOT Stage 2 / 1: extensions, helpers, tables.
-- Rules: ULID text PKs, soft delete, created_at/updated_at, tenant_id on tenant-owned tables.

create extension if not exists btree_gist;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- gen_ulid()
-- 26-char Crockford base32 ULID: 48-bit ms timestamp + 80 random bits.
create or replace function public.gen_ulid()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  enc  constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ts   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rnd  bytea := extensions.gen_random_bytes(10);
  res  text := '';
  i    int;
  j    int;
  v    int;
begin
  for i in reverse 9..0 loop
    res := res || substr(enc, ((ts >> (5 * i)) & 31)::int + 1, 1);
  end loop;
  for i in 0..15 loop
    v := 0;
    for j in 0..4 loop
      v := (v << 1) | get_bit(rnd, i * 5 + j);
    end loop;
    res := res || substr(enc, v + 1, 1);
  end loop;
  return res;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------------------------- tables
create table public.profiles (
  id               text primary key default public.gen_ulid(),
  auth_user_id     uuid not null unique references auth.users (id) on delete cascade,
  full_name        text,
  phone            text,
  is_platform_admin boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table public.tenants (
  id            text primary key default public.gen_ulid(),
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40
                       and slug not in ('admin','api','platform','register-club','me','c','auth','login',
                                        'signup','join','book','static','assets','js','css','docs','www',
                                        'app','support','help','dinkslot','supabase')),
  name          text not null check (char_length(name) between 2 and 80),
  description   text,
  address       text,
  city          text,
  contact_email text,
  contact_phone text,
  cover_path    text,
  logo_path     text,
  latitude      double precision,
  longitude     double precision,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','suspended')),
  timezone      text not null default 'Asia/Manila',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.tenant_settings (
  id                   text primary key default public.gen_ulid(),
  tenant_id            text not null references public.tenants (id),
  payment_enabled      boolean not null default true,
  qr_path              text,
  payment_instructions text,
  approval_required    boolean not null default true,
  booking_window_days  int not null default 30 check (booking_window_days between 1 and 365),
  min_hours            numeric(4,1) not null default 1 check (min_hours > 0),
  max_hours            numeric(4,1) not null default 3 check (max_hours >= min_hours),
  cancel_cutoff_hours  int not null default 24 check (cancel_cutoff_hours >= 0),
  pending_hold_minutes int not null default 30 check (pending_hold_minutes between 5 and 1440),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create unique index tenant_settings_one_per_tenant on public.tenant_settings (tenant_id) where deleted_at is null;

create table public.tenant_members (
  id         text primary key default public.gen_ulid(),
  tenant_id  text not null references public.tenants (id),
  user_id    uuid not null references auth.users (id),
  role       text not null check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index tenant_members_unique on public.tenant_members (tenant_id, user_id) where deleted_at is null;
create index tenant_members_user_idx on public.tenant_members (user_id) where deleted_at is null;

create table public.club_players (
  id           text primary key default public.gen_ulid(),
  tenant_id    text not null references public.tenants (id),
  user_id      uuid not null references auth.users (id),
  display_name text not null check (char_length(display_name) between 1 and 60),
  phone        text,
  status       text not null default 'active' check (status in ('active','blocked')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (id, tenant_id)
);
create unique index club_players_unique on public.club_players (tenant_id, user_id) where deleted_at is null;
create index club_players_user_idx on public.club_players (user_id) where deleted_at is null;

create table public.courts (
  id          text primary key default public.gen_ulid(),
  tenant_id   text not null references public.tenants (id),
  name        text not null check (char_length(name) between 1 and 60),
  surface     text,
  is_indoor   boolean not null default false,
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  slot_minutes int not null default 60 check (slot_minutes in (15,30,45,60,90,120)),
  open_time   time not null default '06:00',
  close_time  time not null default '22:00',
  status      text not null default 'active' check (status in ('active','maintenance')),
  qr_path     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (close_time > open_time),
  unique (id, tenant_id)
);
create index courts_tenant_idx on public.courts (tenant_id) where deleted_at is null;

create table public.court_blocks (
  id         text primary key default public.gen_ulid(),
  tenant_id  text not null references public.tenants (id),
  court_id   text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  foreign key (court_id, tenant_id) references public.courts (id, tenant_id)
);
create index court_blocks_court_idx on public.court_blocks (court_id, starts_at) where deleted_at is null;

create table public.bookings (
  id              text primary key default public.gen_ulid(),
  tenant_id       text not null references public.tenants (id),
  court_id        text not null,
  player_id       text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  amount          numeric(10,2) not null check (amount >= 0),
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','cancelled','expired')),
  reference_code  text not null,
  expires_at      timestamptz,
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,
  reject_reason   text,
  cancel_reason   text,
  cancelled_by    uuid references auth.users (id),
  cancelled_at    timestamptz,
  idempotency_key text,
  decision_key    text,
  source          text not null default 'online',
  guest_name      text,
  checked_in_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (ends_at > starts_at),
  unique (id, tenant_id),
  foreign key (court_id, tenant_id) references public.courts (id, tenant_id),
  foreign key (player_id, tenant_id) references public.club_players (id, tenant_id)
);
create unique index bookings_idem_unique on public.bookings (player_id, idempotency_key)
  where idempotency_key is not null;
create unique index bookings_reference_unique on public.bookings (tenant_id, reference_code);
create index bookings_player_idx on public.bookings (player_id, starts_at) where deleted_at is null;
create index bookings_tenant_status_idx on public.bookings (tenant_id, status, starts_at) where deleted_at is null;
create index bookings_expiry_idx on public.bookings (expires_at) where status = 'pending' and deleted_at is null;

-- No double booking: pending and approved bookings hold the slot.
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending', 'approved') and deleted_at is null);

create table public.booking_payments (
  id              text primary key default public.gen_ulid(),
  tenant_id       text not null references public.tenants (id),
  booking_id      text not null,
  proof_path      text not null,
  payer_reference text not null check (char_length(btrim(payer_reference)) between 3 and 60),
  idempotency_key text,
  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  foreign key (booking_id, tenant_id) references public.bookings (id, tenant_id)
);
create unique index booking_payments_one_active on public.booking_payments (booking_id) where deleted_at is null;
create unique index booking_payments_ref_unique on public.booking_payments (tenant_id, lower(btrim(payer_reference)))
  where deleted_at is null;
create unique index booking_payments_idem_unique on public.booking_payments (booking_id, idempotency_key)
  where idempotency_key is not null;

create table public.notifications (
  id         text primary key default public.gen_ulid(),
  user_id    uuid not null references auth.users (id),
  tenant_id  text references public.tenants (id),
  type       text not null,
  message    text,
  booking_id text references public.bookings (id),
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc) where deleted_at is null;

create table public.email_log (
  id                  text primary key default public.gen_ulid(),
  tenant_id           text references public.tenants (id),
  booking_id          text references public.bookings (id),
  template            text not null,
  to_address          text not null,
  status              text not null default 'pending' check (status in ('pending','sent','failed')),
  provider_message_id text,
  error               text,
  idempotency_key     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create unique index email_log_idem_unique on public.email_log (idempotency_key, to_address)
  where idempotency_key is not null;

create table public.audit_log (
  id         text primary key default public.gen_ulid(),
  actor_id   uuid,
  tenant_id  text references public.tenants (id),
  entity     text not null,
  entity_id  text,
  action     text not null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

-- updated_at triggers on every table
do $$
declare t text;
begin
  foreach t in array array['profiles','tenants','tenant_settings','tenant_members','club_players','courts',
    'court_blocks','bookings','booking_payments','notifications','email_log','audit_log']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Never hard-delete business rows.
create or replace function public.forbid_hard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'hard delete is not allowed on %; set deleted_at instead', tg_table_name
    using errcode = '42501';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','tenants','tenant_settings','tenant_members','club_players','courts',
    'court_blocks','bookings','booking_payments','notifications','email_log','audit_log']
  loop
    execute format('create trigger forbid_hard_delete before delete on public.%I
                    for each row execute function public.forbid_hard_delete()', t);
  end loop;
end $$;

-- New auth user -> profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (auth_user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
