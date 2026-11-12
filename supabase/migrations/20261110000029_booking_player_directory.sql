-- Staff booking directory excludes club accounts, including legacy memberships.
create or replace function public.club_booking_players(p_tenant_id text)
returns table (id text, display_name text, full_name text, phone text)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_tenant_member(p_tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select cp.id, cp.display_name, coalesce(nullif(btrim(p.full_name), ''), cp.display_name),
      coalesce(nullif(btrim(p.phone), ''), nullif(btrim(cp.phone), ''))
    from public.club_players cp
    join public.profiles p on p.auth_user_id = cp.user_id and p.deleted_at is null
    where cp.tenant_id = p_tenant_id and cp.status = 'active' and cp.deleted_at is null
      and p.account_type is distinct from 'tenant'
    order by coalesce(nullif(btrim(p.full_name), ''), cp.display_name);
end;
$$;
revoke all on function public.club_booking_players(text) from public, anon;
grant execute on function public.club_booking_players(text) to authenticated;
