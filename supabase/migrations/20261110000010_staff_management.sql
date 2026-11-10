-- Stage 4/5: staff management. Only a club OWNER can add or remove staff.
-- Staff can be added only if the person already has a confirmed account.

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

  insert into public.tenant_members (tenant_id, user_id, role) values (p_tenant_id, target, 'staff')
  returning * into m;
  perform public._audit(p_tenant_id, 'tenant_member', m.id, 'add_staff', null,
                        jsonb_build_object('user_id', target));
  perform public._notify_user(target, p_tenant_id, 'staff_added', null, null);
  return m;
end;
$$;

create or replace function public.remove_staff(p_member_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  m public.tenant_members;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into m from public.tenant_members where id = p_member_id and deleted_at is null for update;
  if not found or not public.is_tenant_owner(m.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if m.role = 'owner' then raise exception 'cannot_remove_owner' using errcode = '22023'; end if;
  update public.tenant_members set deleted_at = now() where id = m.id;
  perform public._audit(m.tenant_id, 'tenant_member', m.id, 'remove_staff', to_jsonb(m), null);
end;
$$;

create or replace function public.list_tenant_staff(p_tenant_id text)
returns table (member_id text, user_id uuid, role text, email text, full_name text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_tenant_owner(p_tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.id, m.user_id, m.role, u.email::text, pr.full_name, m.created_at
    from public.tenant_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles pr on pr.auth_user_id = m.user_id
    where m.tenant_id = p_tenant_id and m.deleted_at is null
    order by m.role desc, m.created_at;
end;
$$;

revoke all on function public.add_staff(text,text), public.remove_staff(text),
  public.list_tenant_staff(text) from public, anon, authenticated;
grant execute on function public.add_staff(text,text), public.remove_staff(text),
  public.list_tenant_staff(text) to authenticated;
