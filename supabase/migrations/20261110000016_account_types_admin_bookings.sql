-- Separate registrations for players and clubs (tenants), and bookings made by the club itself.
--
-- account_type: 'player' (books courts) or 'tenant' (runs a club). null = not chosen yet
-- (for example a first Google sign-in); it is fixed the first time the person acts:
--   register_club -> tenant      join_club / admin_add_player -> player
-- Rules enforced here, in Postgres:
--   * a player account cannot register a club
--   * a club account (owner or staff) cannot join clubs or book as a player
--   * a player account cannot be added as club staff
--   * club owners and staff can create bookings for a guest (walk-in) or for a registered player

alter table public.profiles
  add column account_type text check (account_type in ('player', 'tenant'));

-- existing accounts: managers are tenant accounts, everyone else is a player
update public.profiles p set account_type = case
    when exists (select 1 from public.tenant_members m where m.user_id = p.auth_user_id and m.deleted_at is null) then 'tenant'
    when p.is_platform_admin then null
    else 'player' end;

-- new sign-ups can say what they are (checked values only; default is "not chosen yet")
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  t text := new.raw_user_meta_data ->> 'account_type';
begin
  insert into public.profiles (auth_user_id, full_name, account_type)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          case when t in ('player', 'tenant') then t end)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- First-time choice (used after a Google sign-in, which cannot carry metadata). Locked afterwards.
create or replace function public.choose_account_type(p_type text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cur text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_type not in ('player', 'tenant') then raise exception 'invalid_account_type' using errcode = '22023'; end if;
  select account_type into cur from public.profiles where auth_user_id = uid and deleted_at is null for update;
  if cur is null then
    if p_type = 'tenant' and exists (select 1 from public.club_players c where c.user_id = uid and c.deleted_at is null) then
      raise exception 'account_type_locked' using errcode = '42501';
    end if;
    if p_type = 'player' and exists (select 1 from public.tenant_members m where m.user_id = uid and m.deleted_at is null) then
      raise exception 'account_type_locked' using errcode = '42501';
    end if;
    update public.profiles set account_type = p_type where auth_user_id = uid;
    return p_type;
  end if;
  if cur <> p_type then raise exception 'account_type_locked' using errcode = '42501'; end if;
  return cur;
end;
$$;

-- ----------------------------------------------------------------- guards (triggers)
-- A club account cannot become a player of any club.
create or replace function public.guard_club_player_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.tenant_members m where m.user_id = new.user_id and m.deleted_at is null)
     or exists (select 1 from public.profiles p where p.auth_user_id = new.user_id and p.account_type = 'tenant') then
    raise exception 'club_account_cannot_book' using errcode = '42501';
  end if;
  update public.profiles set account_type = 'player' where auth_user_id = new.user_id and account_type is null;
  return new;
end;
$$;
create trigger guard_club_player_account before insert on public.club_players
  for each row execute function public.guard_club_player_account();

-- A player account cannot be club staff or owner.
create or replace function public.guard_member_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles p where p.auth_user_id = new.user_id and p.account_type = 'player')
     or exists (select 1 from public.club_players c where c.user_id = new.user_id and c.deleted_at is null) then
    raise exception 'user_is_player' using errcode = '42501';
  end if;
  update public.profiles set account_type = 'tenant' where auth_user_id = new.user_id and account_type is null;
  return new;
end;
$$;
create trigger guard_member_account before insert on public.tenant_members
  for each row execute function public.guard_member_account();

-- --------------------------------------------------------------------- register_club
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
  pass_id text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  p_slug := lower(btrim(p_slug));

  select tn.* into t from public.tenants tn
  join public.tenant_members m on m.tenant_id = tn.id and m.user_id = uid and m.role = 'owner'
  where tn.slug = p_slug and tn.deleted_at is null and m.deleted_at is null;
  if found then return t; end if;

  if exists (select 1 from public.tenant_members m where m.user_id = uid and m.deleted_at is null) then
    raise exception 'already_has_club' using errcode = '23505';
  end if;
  -- player accounts cannot register a club (the guard trigger would also catch it)
  if exists (select 1 from public.profiles p where p.auth_user_id = uid and p.account_type = 'player')
     or exists (select 1 from public.club_players c where c.user_id = uid and c.deleted_at is null) then
    raise exception 'player_account_cannot_register_club' using errcode = '42501';
  end if;

  select cp.id into pass_id from public.captcha_passes cp
   where cp.user_id = uid and cp.purpose = 'register_club' and cp.used_at is null
     and cp.expires_at > now() and cp.deleted_at is null
   order by cp.created_at limit 1 for update skip locked;
  if pass_id is null then raise exception 'captcha_required' using errcode = '42501'; end if;

  begin
    insert into public.tenants (slug, name, description, address, city, contact_email, contact_phone)
    values (p_slug, btrim(p_name), p_description, p_address, p_city, p_contact_email, p_contact_phone)
    returning * into t;
  exception
    when unique_violation then raise exception 'slug_taken' using errcode = '23505';
    when check_violation then raise exception 'invalid_slug_or_name' using errcode = '23514';
  end;

  update public.captcha_passes set used_at = now() where id = pass_id;
  insert into public.tenant_settings (tenant_id) values (t.id);
  begin
    insert into public.tenant_members (tenant_id, user_id, role) values (t.id, uid, 'owner');
  exception when unique_violation then
    raise exception 'already_has_club' using errcode = '23505';
  end;
  perform public._audit(t.id, 'tenant', t.id, 'register', null, to_jsonb(t));
  return t;
end;
$$;

-- --------------------------------------------------------------------- join_club
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
  returning * into cp;  -- the guard trigger refuses club accounts
  return cp;
end;
$$;

-- ----------------------------------------------------------------- bookings by the club
alter table public.bookings add column guest_phone text;
create unique index bookings_admin_idem_unique on public.bookings (tenant_id, idempotency_key)
  where source in ('walk_in', 'admin') and idempotency_key is not null;

-- A club owner/staff books a court for a walk-in guest (name only) or for a registered player of the club.
-- The booking is approved straight away (the club handles payment itself) and holds the slot.
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
  mins numeric;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into c from public.courts where id = p_court_id and deleted_at is null;
  if not found or not public.is_tenant_member(c.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';  -- same answer for "missing" and "not your club"
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
  if l_start::date <> l_end::date then raise exception 'crosses_midnight' using errcode = '22023'; end if;
  if l_start::time < c.open_time or l_end::time > c.close_time then
    raise exception 'outside_opening_hours' using errcode = '22023';
  end if;
  mins := extract(epoch from (l_start::time - c.open_time)) / 60;
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

-- Add an existing player account to this club's player list (so the club can book for them).
create or replace function public.admin_add_player(p_tenant_id text, p_email text)
returns public.club_players
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  nm text;
  cp public.club_players;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_tenant_member(p_tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select u.id, coalesce(nullif(btrim(pr.full_name), ''), split_part(u.email, '@', 1))
    into target, nm
  from auth.users u left join public.profiles pr on pr.auth_user_id = u.id
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null and u.deleted_at is null;
  if target is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;

  select * into cp from public.club_players where tenant_id = p_tenant_id and user_id = target and deleted_at is null;
  if found then return cp; end if;

  insert into public.club_players (tenant_id, user_id, display_name)
  values (p_tenant_id, target, left(nm, 60)) returning * into cp;  -- guard refuses club accounts
  perform public._audit(p_tenant_id, 'club_player', cp.id, 'admin_add_player', null, jsonb_build_object('user_id', target));
  perform public._notify_user(target, p_tenant_id, 'added_to_club', null, null);
  return cp;
end;
$$;

revoke all on function public.choose_account_type(text), public.register_club(text,text,text,text,text,text,text),
  public.join_club(text,text,text),
  public.create_admin_booking(text,timestamptz,timestamptz,text,text,text,text),
  public.admin_add_player(text,text) from public, anon, authenticated;
grant execute on function public.choose_account_type(text), public.register_club(text,text,text,text,text,text,text),
  public.join_club(text,text,text),
  public.create_admin_booking(text,timestamptz,timestamptz,text,text,text,text),
  public.admin_add_player(text,text) to authenticated;
