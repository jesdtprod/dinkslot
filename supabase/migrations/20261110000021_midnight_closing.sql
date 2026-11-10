-- Courts may close at MIDNIGHT. A closing time of 00:00 means the END of the day (24:00), so
--   open 06:00 / close 00:00  = 6 AM to 12 midnight (last hourly slot 11 PM to 12 AM)
--   open 00:00 / close 00:00  = open 24 hours
-- A booking may end exactly at midnight, but cannot run past it (no overnight bookings).

alter table public.courts drop constraint courts_check;
alter table public.courts add constraint courts_hours_check
  check (close_time = time '00:00' or close_time > open_time);

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
    values (c.tenant_id, c.id, cp.id, p_starts_at, p_ends_at, round(c.hourly_rate * hrs, 2), v_status,
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
    values (c.tenant_id, c.id, cp.id, p_starts_at, p_ends_at, round(c.hourly_rate * mins / 60, 2), 'approved',
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
