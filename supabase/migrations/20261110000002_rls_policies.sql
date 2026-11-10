-- DINKSLOT Stage 2 / 2: tenant isolation. RLS enabled AND forced on every table.

-- ------------------------------------------------------------ lock down grants
-- Supabase grants everything to anon/authenticated by default. Start from zero.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- ----------------------------------------------------------- access helpers
-- Security definer so policies never recurse. Each checks auth.uid() first.
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.auth_user_id = auth.uid() and p.is_platform_admin and p.deleted_at is null);
$$;

create or replace function public.is_tenant_member(p_tenant_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.deleted_at is null
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.deleted_at is null);
$$;

create or replace function public.is_tenant_owner(p_tenant_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.deleted_at is null
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and m.role = 'owner' and m.deleted_at is null);
$$;

-- Active (not blocked) player of this club.
create or replace function public.is_club_player(p_tenant_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.club_players c
    join public.tenants t on t.id = c.tenant_id and t.status = 'approved' and t.deleted_at is null
    where c.tenant_id = p_tenant_id and c.user_id = auth.uid()
      and c.status = 'active' and c.deleted_at is null);
$$;

create or replace function public.is_my_player(p_player_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and p_player_id is not null and exists (
    select 1 from public.club_players c
    where c.id = p_player_id and c.user_id = auth.uid() and c.deleted_at is null);
$$;

grant execute on function public.is_platform_admin(), public.is_tenant_member(text),
  public.is_tenant_owner(text), public.is_club_player(text), public.is_my_player(text)
  to authenticated;

-- ---------------------------------------------------------------- enable RLS
do $$
declare t text;
begin
  foreach t in array array['profiles','tenants','tenant_settings','tenant_members','club_players','courts',
    'court_blocks','bookings','booking_payments','notifications','email_log','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ----------------------------------------------------------------- policies
-- profiles: own row, or platform admin.
create policy profiles_select on public.profiles for select to authenticated
  using (deleted_at is null and (auth_user_id = auth.uid() or public.is_platform_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (deleted_at is null and auth_user_id = auth.uid())
  with check (deleted_at is null and auth_user_id = auth.uid());

-- tenants: members and platform admin read directly. Public reads go through public_clubs.
create policy tenants_select on public.tenants for select to authenticated
  using (deleted_at is null and (public.is_tenant_member(id) or public.is_platform_admin()));
create policy tenants_update on public.tenants for update to authenticated
  using (deleted_at is null and public.is_tenant_owner(id))
  with check (deleted_at is null and public.is_tenant_owner(id));

-- tenant_settings
create policy tenant_settings_select on public.tenant_settings for select to authenticated
  using (deleted_at is null and (public.is_tenant_member(tenant_id) or public.is_platform_admin()));
create policy tenant_settings_update on public.tenant_settings for update to authenticated
  using (deleted_at is null and public.is_tenant_owner(tenant_id))
  with check (deleted_at is null and public.is_tenant_owner(tenant_id));

-- tenant_members: see own membership and co-members. Writes only through functions.
create policy tenant_members_select on public.tenant_members for select to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.is_tenant_member(tenant_id)
                                 or public.is_platform_admin()));

-- club_players: a player sees own rows; a club admin sees only that club's players.
create policy club_players_select on public.club_players for select to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.is_tenant_member(tenant_id)));
create policy club_players_update on public.club_players for update to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.is_tenant_member(tenant_id)))
  with check (deleted_at is null and (user_id = auth.uid() or public.is_tenant_member(tenant_id)));

-- Only a club admin may change a player's status (blocked/active).
create or replace function public.guard_club_player_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and new.status is distinct from old.status
     and not public.is_tenant_member(old.tenant_id) then
    raise exception 'only a club admin can change player status' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_club_player_update before update on public.club_players
  for each row execute function public.guard_club_player_update();

-- courts: club admins manage them. Players/public read through public_courts.
create policy courts_select on public.courts for select to authenticated
  using (deleted_at is null and (public.is_tenant_member(tenant_id) or public.is_platform_admin()));
create policy courts_insert on public.courts for insert to authenticated
  with check (deleted_at is null and public.is_tenant_member(tenant_id));
create policy courts_update on public.courts for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- court_blocks
create policy court_blocks_select on public.court_blocks for select to authenticated
  using (deleted_at is null and public.is_tenant_member(tenant_id));
create policy court_blocks_insert on public.court_blocks for insert to authenticated
  with check (deleted_at is null and public.is_tenant_member(tenant_id));
create policy court_blocks_update on public.court_blocks for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- bookings: own bookings, or any booking of a club you manage. No client writes.
create policy bookings_select on public.bookings for select to authenticated
  using (deleted_at is null and (public.is_my_player(player_id) or public.is_tenant_member(tenant_id)));

-- booking_payments: the booking's player and that club's admins.
create policy booking_payments_select on public.booking_payments for select to authenticated
  using (deleted_at is null and (
    public.is_tenant_member(tenant_id)
    or exists (select 1 from public.bookings b
               where b.id = booking_payments.booking_id and public.is_my_player(b.player_id))));

-- notifications: own only.
create policy notifications_select on public.notifications for select to authenticated
  using (deleted_at is null and user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (deleted_at is null and user_id = auth.uid())
  with check (deleted_at is null and user_id = auth.uid());

-- email_log, audit_log: club admins read their own club's rows. Written server-side only.
create policy email_log_select on public.email_log for select to authenticated
  using (deleted_at is null and tenant_id is not null and public.is_tenant_member(tenant_id));
create policy audit_log_select on public.audit_log for select to authenticated
  using (deleted_at is null and ((tenant_id is not null and public.is_tenant_owner(tenant_id))
                                 or public.is_platform_admin()));

-- ------------------------------------------------------------ column grants
-- Table privileges are the first gate; RLS is the second. Booking, club, payment,
-- email and audit rows are never written directly by clients.
grant select on public.profiles, public.tenants, public.tenant_settings, public.tenant_members,
  public.club_players, public.courts, public.court_blocks, public.bookings,
  public.booking_payments, public.notifications, public.email_log, public.audit_log
  to authenticated;

grant update (full_name, phone) on public.profiles to authenticated;
grant update (name, description, address, city, contact_email, contact_phone, cover_path, logo_path,
              latitude, longitude, timezone) on public.tenants to authenticated;
grant update (payment_enabled, qr_path, payment_instructions, approval_required, booking_window_days,
              min_hours, max_hours, cancel_cutoff_hours, pending_hold_minutes)
  on public.tenant_settings to authenticated;
grant update (display_name, phone, status) on public.club_players to authenticated;
grant insert (tenant_id, name, surface, is_indoor, hourly_rate, slot_minutes, open_time, close_time,
              status, qr_path) on public.courts to authenticated;
grant update (name, surface, is_indoor, hourly_rate, slot_minutes, open_time, close_time, status,
              qr_path, deleted_at) on public.courts to authenticated;
grant insert (tenant_id, court_id, starts_at, ends_at, reason) on public.court_blocks to authenticated;
grant update (starts_at, ends_at, reason, deleted_at) on public.court_blocks to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- --------------------------------------------------------------- public views
-- Only approved clubs, active courts, non-sensitive columns. Owner-run views
-- (so anon needs no table access); filters are baked in.
create or replace view public.public_clubs with (security_barrier = true) as
  select t.id, t.slug, t.name, t.description, t.address, t.city, t.contact_phone,
         t.cover_path, t.logo_path, t.latitude, t.longitude, t.timezone
  from public.tenants t
  where t.status = 'approved' and t.deleted_at is null;

create or replace view public.public_courts with (security_barrier = true) as
  select c.id, c.tenant_id, t.slug as club_slug, c.name, c.surface, c.is_indoor, c.hourly_rate,
         c.slot_minutes, c.open_time, c.close_time
  from public.courts c
  join public.tenants t on t.id = c.tenant_id
  where t.status = 'approved' and t.deleted_at is null
    and c.status = 'active' and c.deleted_at is null;

grant select on public.public_clubs, public.public_courts to anon, authenticated;
