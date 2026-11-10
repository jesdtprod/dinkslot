-- DINKSLOT Stage 2 / 3: server functions. The frontend only calls these for
-- club, booking and payment writes. Every function checks auth.uid() and role first,
-- derives tenant_id on the server, and sets search_path.

-- ---------------------------------------------------------------- internals
create or replace function public._audit(p_tenant text, p_entity text, p_entity_id text,
                                         p_action text, p_before jsonb, p_after jsonb)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.audit_log (actor_id, tenant_id, entity, entity_id, action, before, after)
  values (auth.uid(), p_tenant, p_entity, p_entity_id, p_action, p_before, p_after);
$$;

create or replace function public._notify_user(p_user uuid, p_tenant text, p_type text,
                                               p_booking text, p_message text)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.notifications (user_id, tenant_id, type, booking_id, message)
  values (p_user, p_tenant, p_type, p_booking, p_message);
$$;

create or replace function public._notify_admins(p_tenant text, p_type text, p_booking text, p_message text)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.notifications (user_id, tenant_id, type, booking_id, message)
  select m.user_id, p_tenant, p_type, p_booking, p_message
  from public.tenant_members m
  where m.tenant_id = p_tenant and m.deleted_at is null;
$$;

revoke all on function public._audit(text, text, text, text, jsonb, jsonb),
  public._notify_user(uuid, text, text, text, text),
  public._notify_admins(text, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------ register_club
create or replace function public.register_club(
  p_name text, p_slug text, p_description text default null, p_address text default null,
  p_city text default null, p_contact_email text default null, p_contact_phone text default null)
returns public.tenants
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.tenants;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  p_slug := lower(btrim(p_slug));

  -- idempotent retry: same owner, same slug
  select tn.* into t from public.tenants tn
  join public.tenant_members m on m.tenant_id = tn.id and m.user_id = uid and m.role = 'owner'
  where tn.slug = p_slug and tn.deleted_at is null and m.deleted_at is null;
  if found then return t; end if;

  begin
    insert into public.tenants (slug, name, description, address, city, contact_email, contact_phone)
    values (p_slug, btrim(p_name), p_description, p_address, p_city, p_contact_email, p_contact_phone)
    returning * into t;
  exception
    when unique_violation then raise exception 'slug_taken' using errcode = '23505';
    when check_violation then raise exception 'invalid_slug_or_name' using errcode = '23514';
  end;

  insert into public.tenant_settings (tenant_id) values (t.id);
  insert into public.tenant_members (tenant_id, user_id, role) values (t.id, uid, 'owner');
  perform public._audit(t.id, 'tenant', t.id, 'register', null, to_jsonb(t));
  return t;
end;
$$;

-- --------------------------------------------------------------- decide_club
create or replace function public.decide_club(p_tenant_id text, p_decision text, p_reason text default null)
returns public.tenants
language plpgsql security definer
set search_path = public
as $$
declare
  before_row public.tenants;
  t public.tenants;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decision not in ('approved','rejected','suspended') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into before_row from public.tenants where id = p_tenant_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.tenants set status = p_decision where id = p_tenant_id returning * into t;
  perform public._audit(t.id, 'tenant', t.id, 'decide_club:' || p_decision,
                        jsonb_build_object('status', before_row.status),
                        jsonb_build_object('status', t.status, 'reason', p_reason));
  insert into public.notifications (user_id, tenant_id, type, message)
  select m.user_id, t.id, 'club_' || p_decision, coalesce(p_reason, '')
  from public.tenant_members m where m.tenant_id = t.id and m.deleted_at is null;
  return t;
end;
$$;

-- ----------------------------------------------------------------- join_club
create or replace function public.join_club(p_slug text, p_display_name text, p_phone text default null)
returns public.club_players
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tid text;
  cp public.club_players;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select id into tid from public.tenants
   where slug = lower(btrim(p_slug)) and status = 'approved' and deleted_at is null;
  if tid is null then raise exception 'club_not_found' using errcode = 'P0002'; end if;

  select * into cp from public.club_players where tenant_id = tid and user_id = uid and deleted_at is null;
  if found then
    if cp.status = 'blocked' then raise exception 'player_blocked' using errcode = '42501'; end if;
    return cp;
  end if;
  insert into public.club_players (tenant_id, user_id, display_name, phone)
  values (tid, uid, btrim(p_display_name), p_phone)
  returning * into cp;
  return cp;
end;
$$;

-- --------------------------------------------------------- court_availability
-- Anyone. Returns ONLY court_id, starts_at, ends_at of taken or blocked time.
create or replace function public.court_availability(p_court_id text, p_from timestamptz, p_to timestamptz)
returns table (court_id text, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.courts c join public.tenants t on t.id = c.tenant_id
    where c.id = p_court_id and c.status = 'active' and c.deleted_at is null
      and t.status = 'approved' and t.deleted_at is null) then
    return;
  end if;
  return query
    select b.court_id, b.starts_at, b.ends_at from public.bookings b
    where b.court_id = p_court_id and b.status in ('pending','approved') and b.deleted_at is null
      and b.starts_at < p_to and b.ends_at > p_from
    union all
    select k.court_id, k.starts_at, k.ends_at from public.court_blocks k
    where k.court_id = p_court_id and k.deleted_at is null
      and k.starts_at < p_to and k.ends_at > p_from
    order by 2;
end;
$$;

-- -------------------------------------------------------- get_booking_info
-- Booking screen data for a joined player: rules, payment instructions, QR path.
create or replace function public.get_booking_info(p_court_id text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  c public.courts;
  s public.tenant_settings;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.courts where id = p_court_id and status = 'active' and deleted_at is null;
  if not found or not public.is_club_player(c.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.tenant_settings where tenant_id = c.tenant_id and deleted_at is null;
  return jsonb_build_object(
    'court_id', c.id, 'hourly_rate', c.hourly_rate,
    'payment_enabled', s.payment_enabled,
    'payment_instructions', case when s.payment_enabled then s.payment_instructions end,
    'qr_path', case when s.payment_enabled then coalesce(c.qr_path, s.qr_path) end,
    'approval_required', s.approval_required,
    'booking_window_days', s.booking_window_days,
    'min_hours', s.min_hours, 'max_hours', s.max_hours,
    'cancel_cutoff_hours', s.cancel_cutoff_hours,
    'pending_hold_minutes', s.pending_hold_minutes);
end;
$$;

-- ------------------------------------------------------------ create_booking
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

  -- retried request returns the original booking
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
  if l_start::date <> l_end::date then
    raise exception 'crosses_midnight' using errcode = '22023';
  end if;
  if l_start::time < c.open_time or l_end::time > c.close_time then
    raise exception 'outside_opening_hours' using errcode = '22023';
  end if;
  mins := extract(epoch from (l_start::time - c.open_time)) / 60;
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

  -- approval off: straight to approved when no payment step is needed
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

-- ------------------------------------------------------ attach_payment_proof
create or replace function public.attach_payment_proof(
  p_booking_id text, p_proof_path text, p_payer_reference text, p_idempotency_key text)
returns public.booking_payments
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b public.bookings;
  s public.tenant_settings;
  pay public.booking_payments;
  folders text[];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found or not public.is_my_player(b.player_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into pay from public.booking_payments
   where booking_id = b.id and idempotency_key = p_idempotency_key;
  if found then return pay; end if;

  if b.status <> 'pending' then raise exception 'invalid_state' using errcode = '22023'; end if;
  select * into s from public.tenant_settings where tenant_id = b.tenant_id and deleted_at is null;
  if not s.payment_enabled then raise exception 'payment_disabled' using errcode = '22023'; end if;

  -- proof must live at <tenant_id>/proofs/<auth uid>/<file>
  folders := string_to_array(p_proof_path, '/');
  if array_length(folders, 1) < 4 or folders[1] <> b.tenant_id or folders[2] <> 'proofs'
     or folders[3] <> uid::text then
    raise exception 'invalid_proof_path' using errcode = '22023';
  end if;

  update public.booking_payments set deleted_at = now() where booking_id = b.id and deleted_at is null;
  begin
    insert into public.booking_payments (tenant_id, booking_id, proof_path, payer_reference, idempotency_key)
    values (b.tenant_id, b.id, p_proof_path, btrim(p_payer_reference), p_idempotency_key)
    returning * into pay;
  exception
    when unique_violation then raise exception 'payer_reference_already_used' using errcode = '23505';
    when check_violation then raise exception 'invalid_payer_reference' using errcode = '23514';
  end;

  -- proof stops the hold; with approval off the booking is approved now
  if s.approval_required then
    update public.bookings set expires_at = null where id = b.id;
  else
    update public.bookings set expires_at = null, status = 'approved', decided_at = now() where id = b.id;
  end if;

  perform public._audit(b.tenant_id, 'booking_payment', pay.id, 'attach_proof', null,
                        jsonb_build_object('booking_id', b.id));
  perform public._notify_admins(b.tenant_id, 'proof_uploaded', b.id, b.reference_code);
  return pay;
end;
$$;

-- ------------------------------------------------------------ decide_booking
create or replace function public.decide_booking(
  p_booking_id text, p_decision text, p_reason text default null, p_idempotency_key text default null)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b public.bookings;
  before_row public.bookings;
  s public.tenant_settings;
  pl public.club_players;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into before_row from public.bookings where id = p_booking_id and deleted_at is null for update;
  -- same error for "missing" and "someone else's club": no probing across tenants
  if not found or not public.is_tenant_member(before_row.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_idempotency_key is not null and before_row.decision_key = p_idempotency_key then
    return before_row;
  end if;
  if before_row.status <> 'pending' then raise exception 'invalid_state' using errcode = '22023'; end if;

  if p_decision = 'rejected' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    select * into s from public.tenant_settings where tenant_id = before_row.tenant_id and deleted_at is null;
    if s.payment_enabled and not exists (
      select 1 from public.booking_payments pp where pp.booking_id = before_row.id and pp.deleted_at is null) then
      raise exception 'proof_required' using errcode = '22023';
    end if;
  end if;

  update public.bookings
     set status = p_decision, decided_by = uid, decided_at = now(), expires_at = null,
         reject_reason = case when p_decision = 'rejected' then btrim(p_reason) end,
         decision_key = p_idempotency_key
   where id = before_row.id returning * into b;

  perform public._audit(b.tenant_id, 'booking', b.id, 'decide:' || p_decision,
                        jsonb_build_object('status', before_row.status),
                        jsonb_build_object('status', b.status, 'reason', p_reason));
  select * into pl from public.club_players where id = b.player_id;
  if pl.id is not null then
    perform public._notify_user(pl.user_id, b.tenant_id, 'booking_' || p_decision, b.id,
                                coalesce(b.reject_reason, b.reference_code));
  end if;
  return b;
end;
$$;

-- ------------------------------------------------------------ cancel_booking
create or replace function public.cancel_booking(
  p_booking_id text, p_reason text default null, p_idempotency_key text default null)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b public.bookings;
  s public.tenant_settings;
  is_admin boolean;
  is_player boolean;
  pl public.club_players;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  is_admin := public.is_tenant_member(b.tenant_id);
  is_player := public.is_my_player(b.player_id);
  if not is_admin and not is_player then raise exception 'not_found' using errcode = 'P0002'; end if;

  if b.status = 'cancelled' then return b; end if; -- retry-safe
  if b.status not in ('pending','approved') then raise exception 'invalid_state' using errcode = '22023'; end if;

  if is_admin then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason_required' using errcode = '22023';
    end if;
  else
    select * into s from public.tenant_settings where tenant_id = b.tenant_id and deleted_at is null;
    if now() > b.starts_at - make_interval(hours => s.cancel_cutoff_hours) then
      raise exception 'past_cancel_cutoff' using errcode = '22023';
    end if;
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_by = uid, cancelled_at = now(), expires_at = null,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = b.id returning * into b;

  perform public._audit(b.tenant_id, 'booking', b.id, 'cancel', null,
                        jsonb_build_object('by_admin', is_admin, 'reason', p_reason));
  if is_admin then
    select * into pl from public.club_players where id = b.player_id;
    if pl.id is not null then
      perform public._notify_user(pl.user_id, b.tenant_id, 'booking_cancelled', b.id, p_reason);
    end if;
  else
    perform public._notify_admins(b.tenant_id, 'booking_cancelled', b.id, b.reference_code);
  end if;
  return b;
end;
$$;

-- ---------------------------------------------------- expire_pending_bookings
-- Called by pg_cron only. Unpaid pending bookings past expires_at become expired.
create or replace function public.expire_pending_bookings()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    update public.bookings b set status = 'expired'
     where b.status = 'pending' and b.deleted_at is null
       and b.expires_at is not null and b.expires_at < now()
     returning b.id, b.tenant_id, b.player_id, b.reference_code
  loop
    n := n + 1;
    insert into public.notifications (user_id, tenant_id, type, booking_id, message)
    select cp.user_id, r.tenant_id, 'booking_expired', r.id, r.reference_code
    from public.club_players cp where cp.id = r.player_id;
  end loop;
  return n;
end;
$$;

-- ------------------------------------------------------------------- grants
revoke all on function public.register_club(text,text,text,text,text,text,text),
  public.decide_club(text,text,text), public.join_club(text,text,text),
  public.court_availability(text,timestamptz,timestamptz), public.get_booking_info(text),
  public.create_booking(text,timestamptz,timestamptz,text),
  public.attach_payment_proof(text,text,text,text), public.decide_booking(text,text,text,text),
  public.cancel_booking(text,text,text), public.expire_pending_bookings()
  from public, anon, authenticated;

grant execute on function public.register_club(text,text,text,text,text,text,text),
  public.decide_club(text,text,text), public.join_club(text,text,text),
  public.get_booking_info(text), public.create_booking(text,timestamptz,timestamptz,text),
  public.attach_payment_proof(text,text,text,text), public.decide_booking(text,text,text,text),
  public.cancel_booking(text,text,text) to authenticated;
grant execute on function public.court_availability(text,timestamptz,timestamptz) to anon, authenticated;
-- expire_pending_bookings: no client grant. pg_cron runs as postgres.
