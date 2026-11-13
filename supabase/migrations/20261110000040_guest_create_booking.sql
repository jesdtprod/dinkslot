-- Service-only guest booking. The trusted edge endpoint must verify CAPTCHA and rate-limit requests.
create unique index guest_online_booking_idempotency on public.bookings (tenant_id,idempotency_key) where source = 'guest_online' and idempotency_key is not null;

create or replace function public.create_guest_booking(
  p_court_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text,
  p_guest_name text, p_guest_phone text, p_guest_email text, p_token_hash text, p_token_expires_at timestamptz)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  c public.courts;
  tn public.tenants;
  s public.tenant_settings;
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
  if p_guest_name is null or length(trim(p_guest_name)) not between 2 and 60 or p_guest_phone is null or length(trim(p_guest_phone)) not between 7 and 30 or p_guest_email is null or length(trim(p_guest_email)) > 254 or trim(p_guest_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_token_hash is null or p_token_expires_at is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_token_expires_at <= now() then
    raise exception 'invalid_guest_details' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into c from public.courts where id = p_court_id and deleted_at is null;
  if not found then raise exception 'court_not_found' using errcode = 'P0002'; end if;
  select * into tn from public.tenants where id = c.tenant_id and deleted_at is null;
  if tn.status <> 'approved' then raise exception 'club_not_approved' using errcode = '42501'; end if;
  if c.status <> 'active' then raise exception 'court_unavailable' using errcode = '42501'; end if;

  -- Serialize retries for the same request before checking its idempotency record.
  perform pg_advisory_xact_lock(hashtextextended(c.tenant_id || ':' || p_idempotency_key, 73));

  select booking_row.* into b from public.bookings booking_row join public.guest_booking_access_tokens t on t.booking_id=booking_row.id where booking_row.tenant_id=c.tenant_id and booking_row.source='guest_online' and booking_row.idempotency_key=p_idempotency_key and t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at > now();
  if found then return b; end if;

  select * into s from public.tenant_settings where tenant_id = c.tenant_id and deleted_at is null;
  if not found then raise exception 'booking_settings_unavailable' using errcode = 'P0002'; end if;

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
                                 reference_code, expires_at, idempotency_key, source, guest_name, guest_phone,
                                 decided_at)
    values (c.tenant_id, c.id, null, p_starts_at, p_ends_at, public.court_price(c.id, p_starts_at, p_ends_at), v_status,
            v_ref, v_expires, p_idempotency_key, 'guest_online', trim(p_guest_name), trim(p_guest_phone),
            case when v_status = 'approved' then now() end)
    returning * into b;
  exception
    when exclusion_violation then raise exception 'slot_taken' using errcode = '23P01';
    when unique_violation then raise exception 'duplicate_guest_request' using errcode = '23505';
  end;

  perform public._audit(c.tenant_id, 'booking', b.id, 'create', null, to_jsonb(b));
  insert into public.guest_booking_contacts (booking_id,email) values (b.id,lower(trim(p_guest_email)));
  insert into public.guest_booking_access_tokens (booking_id,token_hash,expires_at) values (b.id,p_token_hash,p_token_expires_at);
  perform public._notify_admins(c.tenant_id, 'booking_requested', b.id, b.reference_code);
  return b;
end;
$$;

revoke all on function public.create_guest_booking(text,timestamptz,timestamptz,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_guest_booking(text,timestamptz,timestamptz,text,text,text,text,text,timestamptz) to service_role;
