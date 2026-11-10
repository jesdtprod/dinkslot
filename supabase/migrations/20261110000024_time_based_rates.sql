-- Time-based pricing (rate bands).
-- A band = days (every day / weekdays Mon-Fri / weekends Sat-Sun) + a time range + an hourly rate.
-- Scope: one court, or the WHOLE CLUB (court_id null). Example:
--   06:00-18:00 = 150/hr, 18:00-midnight = 200/hr.
-- Which rate applies to a slot (first match wins):
--   1. this court, weekday/weekend band      3. club-wide, weekday/weekend band
--   2. this court, "every day" band          4. club-wide, "every day" band
--   5. the court's own hourly_rate (courts.hourly_rate) when no band covers the time
-- Each slot is charged at the rate in force when the slot STARTS. Weekend = Saturday and Sunday,
-- in the club's timezone. The price is always computed in the database (court_price).

create table public.court_rates (
  id          text primary key default public.gen_ulid(),
  tenant_id   text not null references public.tenants (id),
  court_id    text,                                   -- null = applies to every court of the club
  day_type    text not null default 'all' check (day_type in ('all', 'weekday', 'weekend')),
  start_min   int  not null check (start_min between 0 and 1439),   -- minutes after local midnight
  end_min     int  not null check (end_min between 1 and 1440),     -- 1440 = midnight (end of day)
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (end_min > start_min),
  foreign key (court_id, tenant_id) references public.courts (id, tenant_id),
  -- bands of the same scope and day type may not overlap
  constraint court_rates_no_overlap exclude using gist (
    tenant_id with =, (coalesce(court_id, '')) with =, day_type with =,
    int4range(start_min, end_min) with &&) where (deleted_at is null)
);
create index court_rates_tenant_idx on public.court_rates (tenant_id) where deleted_at is null;

create trigger set_updated_at before update on public.court_rates
  for each row execute function public.set_updated_at();
create trigger forbid_hard_delete before delete on public.court_rates
  for each row execute function public.forbid_hard_delete();

alter table public.court_rates enable row level security;
alter table public.court_rates force row level security;
create policy court_rates_select on public.court_rates for select to authenticated
  using (deleted_at is null and public.is_tenant_member(tenant_id));
create policy court_rates_insert on public.court_rates for insert to authenticated
  with check (deleted_at is null and public.is_tenant_member(tenant_id));
create policy court_rates_update on public.court_rates for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
grant select on public.court_rates to authenticated;
grant insert (tenant_id, court_id, day_type, start_min, end_min, hourly_rate) on public.court_rates to authenticated;
grant update (day_type, start_min, end_min, hourly_rate) on public.court_rates to authenticated;

create trigger rl_rates_insert before insert on public.court_rates
  for each row execute function public.rate_limit_trigger('rate', '200', '3600');

create or replace function public.delete_court_rate(p_rate_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r public.court_rates;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into r from public.court_rates where id = p_rate_id and deleted_at is null for update;
  if not found or not public.is_tenant_member(r.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.court_rates set deleted_at = now() where id = r.id;
  perform public._audit(r.tenant_id, 'court_rate', r.id, 'delete', to_jsonb(r), null);
end;
$$;
revoke all on function public.delete_court_rate(text) from public, anon, authenticated;
grant execute on function public.delete_court_rate(text) to authenticated;

-- deleting a court also retires its rate bands
create or replace function public.delete_court(p_court_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  c public.courts;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.courts where id = p_court_id and deleted_at is null for update;
  if not found or not public.is_tenant_member(c.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.bookings b
              where b.court_id = c.id and b.status in ('pending','approved')
                and b.deleted_at is null and b.ends_at > now()) then
    raise exception 'court_has_bookings' using errcode = '22023';
  end if;
  update public.courts set deleted_at = now() where id = c.id;
  update public.court_blocks set deleted_at = now() where court_id = c.id and deleted_at is null;
  update public.court_rates set deleted_at = now() where court_id = c.id and deleted_at is null;
  perform public._audit(c.tenant_id, 'court', c.id, 'delete', to_jsonb(c), null);
end;
$$;
revoke all on function public.delete_court(text) from public, anon, authenticated;
grant execute on function public.delete_court(text) to authenticated;

-- --------------------------------------------------------------- price resolution
-- hourly rate in force for a court at a LOCAL (club timezone) date and time
create or replace function public._rate_at(p_court_id text, p_tenant_id text, p_base numeric, p_local timestamp)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select r.hourly_rate
    from public.court_rates r
    where r.tenant_id = p_tenant_id and r.deleted_at is null
      and (r.court_id = p_court_id or r.court_id is null)
      and r.day_type in ('all', case when extract(isodow from p_local) in (6, 7) then 'weekend' else 'weekday' end)
      and r.start_min <= (extract(hour from p_local) * 60 + extract(minute from p_local))
      and r.end_min   >  (extract(hour from p_local) * 60 + extract(minute from p_local))
    order by (r.court_id is not null) desc, (r.day_type <> 'all') desc
    limit 1), p_base);
$$;
revoke all on function public._rate_at(text, text, numeric, timestamp) from public, anon, authenticated;

-- total price of a booking: every slot at the rate in force when that slot starts
create or replace function public.court_price(p_court_id text, p_starts timestamptz, p_ends timestamptz)
returns numeric
language plpgsql stable security definer
set search_path = public
as $$
declare
  c public.courts;
  tz text;
  t timestamptz := p_starts;
  total numeric := 0;
  seg numeric;
begin
  select * into c from public.courts where id = p_court_id;
  select timezone into tz from public.tenants where id = c.tenant_id;
  while t < p_ends loop
    seg := least(c.slot_minutes, extract(epoch from (p_ends - t)) / 60);
    total := total + public._rate_at(c.id, c.tenant_id, c.hourly_rate, t at time zone tz) * seg / 60;
    t := t + make_interval(mins => c.slot_minutes);
  end loop;
  return round(total, 2);
end;
$$;
revoke all on function public.court_price(text, timestamptz, timestamptz) from public, anon, authenticated;

-- rate of every slot of one day, for the booking screen (same function the price uses)
create or replace function public.court_slot_rates(p_court_id text, p_date date)
returns table (start_min int, hourly_rate numeric)
language plpgsql stable security definer
set search_path = public
as $$
declare
  c public.courts;
  m int;
  close_m int;
begin
  select c0.* into c from public.courts c0 join public.tenants t on t.id = c0.tenant_id
   where c0.id = p_court_id and c0.status = 'active' and c0.deleted_at is null
     and t.status = 'approved' and t.deleted_at is null;
  if not found then return; end if;
  m := (extract(epoch from c.open_time) / 60)::int;
  close_m := case when c.close_time = time '00:00' then 1440 else (extract(epoch from c.close_time) / 60)::int end;
  while m + c.slot_minutes <= close_m loop
    start_min := m;
    hourly_rate := public._rate_at(c.id, c.tenant_id, c.hourly_rate, p_date + make_interval(mins => m));
    return next;
    m := m + c.slot_minutes;
  end loop;
end;
$$;
revoke all on function public.court_slot_rates(text, date) from public, anon, authenticated;
grant execute on function public.court_slot_rates(text, date) to anon, authenticated;

-- cheapest and dearest hourly rate of a court across a week (for "PHP 150-200/hr" on cards)
create or replace function public._court_rate_range(p_court_id text, p_tenant_id text, p_base numeric,
  p_open time, p_close time, p_slot int)
returns numrange
language plpgsql stable security definer
set search_path = public
as $$
declare
  m int;
  close_m int := case when p_close = time '00:00' then 1440 else (extract(epoch from p_close) / 60)::int end;
  d date;
  r numeric;
  lo numeric;
  hi numeric;
begin
  foreach d in array array[date '2026-01-05', date '2026-01-10'] loop   -- a Monday and a Saturday
    m := (extract(epoch from p_open) / 60)::int;
    while m + p_slot <= close_m loop
      r := public._rate_at(p_court_id, p_tenant_id, p_base, d + make_interval(mins => m));
      lo := least(coalesce(lo, r), r);
      hi := greatest(coalesce(hi, r), r);
      m := m + p_slot;
    end loop;
  end loop;
  return numrange(coalesce(lo, p_base), coalesce(hi, p_base), '[]');
end;
$$;
revoke all on function public._court_rate_range(text, text, numeric, time, time, int) from public, anon, authenticated;

create or replace view public.public_courts with (security_barrier = true) as
  select c.id, c.tenant_id, t.slug as club_slug, c.name, c.surface, c.is_indoor, c.hourly_rate,
         c.slot_minutes, c.open_time, c.close_time,
         lower(rr.r) as rate_min, upper(rr.r) as rate_max
  from public.courts c
  join public.tenants t on t.id = c.tenant_id
  cross join lateral (select public._court_rate_range(c.id, c.tenant_id, c.hourly_rate,
                              c.open_time, c.close_time, c.slot_minutes) as r) rr
  where t.status = 'approved' and t.deleted_at is null
    and c.status = 'active' and c.deleted_at is null;
grant select on public.public_courts to anon, authenticated;

-- ------------------------------------------------ bookings now priced by the bands
-- ------------------------------------------------------------------ create_booking
create or replace function public.create_booking(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c public.courts;
  tn public.tenants;
  s public.tenant_settings;
  cp public.club_players;
  b public.bookings;
  l_start timestamp;
  l_end timestamp;
  open_m numeric;
  close_m numeric;
  start_m numeric;
  end_m numeric;
  mins numeric;
  hrs numeric;
  v_status text := 'pending';
  v_expires timestamptz;
  v_ref text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into c from public.courts where id = p_court_id and deleted_at is null;
  if not found then raise exception 'court_not_found' using errcode = 'P0002'; end if;
  select * into tn from public.tenants where id = c.tenant_id and deleted_at is null;
  if tn.status <> 'approved' then raise exception 'club_not_approved' using errcode = '42501'; end if;
  if c.status <> 'active' then raise exception 'court_unavailable' using errcode = '42501'; end if;

  select * into cp from public.club_players
   where tenant_id = c.tenant_id and user_id = uid and deleted_at is null;
  if not found then raise exception 'join_club_first' using errcode = '42501'; end if;
  if cp.status <> 'active' then raise exception 'player_blocked' using errcode = '42501'; end if;

  select * into b from public.bookings where player_id = cp.id and idempotency_key = p_idempotency_key;
  if found then return b; end if;

  select * into s from public.tenant_settings where tenant_id = c.tenant_id and deleted_at is null;

  if p_ends_at <= p_starts_at then raise exception 'invalid_time_range' using errcode = '22023'; end if;
  if p_starts_at <= now() then raise exception 'in_the_past' using errcode = '22023'; end if;
  if p_starts_at > now() + make_interval(days => s.booking_window_days) then
    raise exception 'outside_booking_window' using errcode = '22023';
  end if;

  l_start := p_starts_at at time zone tn.timezone;
  l_end   := p_ends_at at time zone tn.timezone;
  open_m  := extract(epoch from c.open_time) / 60;
  close_m := case when c.close_time = time '00:00' then 1440 else extract(epoch from c.close_time) / 60 end;
  start_m := extract(epoch from l_start::time) / 60;
  end_m   := extract(epoch from (l_end - l_start::date::timestamp)) / 60;  -- minutes after the START day's midnight
  if end_m > 1440 then raise exception 'crosses_midnight' using errcode = '22023'; end if;
  if start_m < open_m or end_m > close_m then raise exception 'outside_opening_hours' using errcode = '22023'; end if;
  mins := start_m - open_m;
  if mins <> floor(mins) or mod(mins::int, c.slot_minutes) <> 0 then
    raise exception 'not_on_slot_grid' using errcode = '22023';
  end if;
  mins := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  if mod(mins::int, c.slot_minutes) <> 0 then
    raise exception 'not_on_slot_grid' using errcode = '22023';
  end if;
  hrs := mins / 60;
  if hrs < s.min_hours or hrs > s.max_hours then
    raise exception 'duration_not_allowed' using errcode = '22023';
  end if;

  if exists (select 1 from public.court_blocks k
             where k.court_id = c.id and k.deleted_at is null
               and k.starts_at < p_ends_at and k.ends_at > p_starts_at) then
    raise exception 'slot_blocked' using errcode = '23P01';
  end if;

  if not s.approval_required and not s.payment_enabled then v_status := 'approved'; end if;
  if s.payment_enabled then v_expires := now() + make_interval(mins => s.pending_hold_minutes); end if;
  if v_status = 'approved' then v_expires := null; end if;

  v_ref := 'DS-' || substr(public.gen_ulid(), 18, 9);
  begin
    insert into public.bookings (tenant_id, court_id, player_id, starts_at, ends_at, amount, status,
                                 reference_code, expires_at, idempotency_key,
                                 decided_at)
    values (c.tenant_id, c.id, cp.id, p_starts_at, p_ends_at, public.court_price(c.id, p_starts_at, p_ends_at), v_status,
            v_ref, v_expires, p_idempotency_key,
            case when v_status = 'approved' then now() end)
    returning * into b;
  exception
    when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
    when unique_violation then
      select * into b from public.bookings where player_id = cp.id and idempotency_key = p_idempotency_key;
      if found then return b; end if;
      raise;
  end;

  perform public._audit(c.tenant_id, 'booking', b.id, 'create', null, to_jsonb(b));
  perform public._notify_user(uid, c.tenant_id,
    case when v_status = 'approved' then 'booking_approved' else 'booking_received' end, b.id, b.reference_code);
  perform public._notify_admins(c.tenant_id, 'booking_requested', b.id, b.reference_code);
  return b;
end;
$$;

-- ------------------------------------------------------------ create_admin_booking
create or replace function public.create_admin_booking(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text,
  p_player_id text default null, p_guest_name text default null, p_guest_phone text default null)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c public.courts;
  tn public.tenants;
  cp public.club_players;
  b public.bookings;
  guest text := nullif(btrim(coalesce(p_guest_name, '')), '');
  l_start timestamp;
  l_end timestamp;
  open_m numeric;
  close_m numeric;
  start_m numeric;
  end_m numeric;
  mins numeric;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into c from public.courts where id = p_court_id and deleted_at is null;
  if not found or not public.is_tenant_member(c.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into tn from public.tenants where id = c.tenant_id and deleted_at is null;

  select * into b from public.bookings
   where tenant_id = c.tenant_id and idempotency_key = p_idempotency_key and source in ('walk_in', 'admin');
  if found then return b; end if;

  if tn.status <> 'approved' then raise exception 'club_not_approved' using errcode = '42501'; end if;
  if c.status <> 'active' then raise exception 'court_unavailable' using errcode = '42501'; end if;
  if (p_player_id is null) = (guest is null) then
    raise exception 'choose_player_or_guest' using errcode = '22023';
  end if;
  if guest is not null and char_length(guest) > 60 then raise exception 'guest_name_too_long' using errcode = '22023'; end if;
  if p_player_id is not null then
    select * into cp from public.club_players
     where id = p_player_id and tenant_id = c.tenant_id and deleted_at is null;
    if not found then raise exception 'player_not_found' using errcode = 'P0002'; end if;
    if cp.status <> 'active' then raise exception 'player_blocked' using errcode = '42501'; end if;
  end if;

  if p_ends_at <= p_starts_at then raise exception 'invalid_time_range' using errcode = '22023'; end if;
  if p_ends_at <= now() then raise exception 'in_the_past' using errcode = '22023'; end if;
  l_start := p_starts_at at time zone tn.timezone;
  l_end   := p_ends_at at time zone tn.timezone;
  open_m  := extract(epoch from c.open_time) / 60;
  close_m := case when c.close_time = time '00:00' then 1440 else extract(epoch from c.close_time) / 60 end;
  start_m := extract(epoch from l_start::time) / 60;
  end_m   := extract(epoch from (l_end - l_start::date::timestamp)) / 60;
  if end_m > 1440 then raise exception 'crosses_midnight' using errcode = '22023'; end if;
  if start_m < open_m or end_m > close_m then raise exception 'outside_opening_hours' using errcode = '22023'; end if;
  mins := start_m - open_m;
  if mins <> floor(mins) or mod(mins::int, c.slot_minutes) <> 0 then raise exception 'not_on_slot_grid' using errcode = '22023'; end if;
  mins := extract(epoch from (p_ends_at - p_starts_at)) / 60;
  if mod(mins::int, c.slot_minutes) <> 0 then raise exception 'not_on_slot_grid' using errcode = '22023'; end if;

  if exists (select 1 from public.court_blocks k
             where k.court_id = c.id and k.deleted_at is null
               and k.starts_at < p_ends_at and k.ends_at > p_starts_at) then
    raise exception 'slot_blocked' using errcode = '23P01';
  end if;

  begin
    insert into public.bookings (tenant_id, court_id, player_id, starts_at, ends_at, amount, status, reference_code,
                                 expires_at, idempotency_key, source, guest_name, guest_phone, decided_by, decided_at)
    values (c.tenant_id, c.id, cp.id, p_starts_at, p_ends_at, public.court_price(c.id, p_starts_at, p_ends_at), 'approved',
            'DS-' || substr(public.gen_ulid(), 18, 9), null, p_idempotency_key,
            case when cp.id is null then 'walk_in' else 'admin' end,
            guest, nullif(btrim(coalesce(p_guest_phone, '')), ''), uid, now())
    returning * into b;
  exception
    when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
    when unique_violation then
      select * into b from public.bookings
       where tenant_id = c.tenant_id and idempotency_key = p_idempotency_key and source in ('walk_in', 'admin');
      if found then return b; end if;
      raise;
  end;

  perform public._audit(c.tenant_id, 'booking', b.id, 'create_by_club', null, to_jsonb(b));
  if cp.id is not null then
    perform public._notify_user(cp.user_id, c.tenant_id, 'booking_approved', b.id, b.reference_code);
  end if;
  return b;
end;
$$;

revoke all on function public.create_booking(text,timestamptz,timestamptz,text),
  public.create_admin_booking(text,timestamptz,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_booking(text,timestamptz,timestamptz,text),
  public.create_admin_booking(text,timestamptz,timestamptz,text,text,text,text) to authenticated;
