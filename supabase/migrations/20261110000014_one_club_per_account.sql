-- One account manages one club, as owner or as staff. Enforced in the database:
--  * a unique index allows at most one active tenant_members row per user
--  * register_club and add_staff give clear errors before hitting the index
-- Playing as a customer at any number of clubs (club_players) is unaffected.

create unique index tenant_members_one_club_per_user
  on public.tenant_members (user_id) where deleted_at is null;

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

  -- idempotent retry: same owner, same slug
  select tn.* into t from public.tenants tn
  join public.tenant_members m on m.tenant_id = tn.id and m.user_id = uid and m.role = 'owner'
  where tn.slug = p_slug and tn.deleted_at is null and m.deleted_at is null;
  if found then return t; end if;

  -- one account, one club (owner or staff); checked before a CAPTCHA pass is used up
  if exists (select 1 from public.tenant_members m where m.user_id = uid and m.deleted_at is null) then
    raise exception 'already_has_club' using errcode = '23505';
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
    raise exception 'already_has_club' using errcode = '23505'; -- concurrent double submit
  end;
  perform public._audit(t.id, 'tenant', t.id, 'register', null, to_jsonb(t));
  return t;
end;
$$;

create or replace function public.add_staff(p_tenant_id text, p_email text)
returns public.tenant_members
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target uuid;
  m public.tenant_members;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_tenant_owner(p_tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select u.id into target from auth.users u
   where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null and u.deleted_at is null;
  if target is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;

  select * into m from public.tenant_members
   where tenant_id = p_tenant_id and user_id = target and deleted_at is null;
  if found then return m; end if;

  -- one account, one club: the person must not already manage another club
  if exists (select 1 from public.tenant_members x where x.user_id = target and x.deleted_at is null) then
    raise exception 'user_in_other_club' using errcode = '23505';
  end if;

  begin
    insert into public.tenant_members (tenant_id, user_id, role) values (p_tenant_id, target, 'staff')
    returning * into m;
  exception when unique_violation then
    raise exception 'user_in_other_club' using errcode = '23505';
  end;
  perform public._audit(p_tenant_id, 'tenant_member', m.id, 'add_staff', null,
                        jsonb_build_object('user_id', target));
  perform public._notify_user(target, p_tenant_id, 'staff_added', null, null);
  return m;
end;
$$;

revoke all on function public.register_club(text,text,text,text,text,text,text),
  public.add_staff(text,text) from public, anon, authenticated;
grant execute on function public.register_club(text,text,text,text,text,text,text),
  public.add_staff(text,text) to authenticated;
