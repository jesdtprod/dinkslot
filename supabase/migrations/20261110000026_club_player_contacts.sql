-- Expose only player contact details to staff of the selected club.
create or replace function public.club_player_contacts(p_tenant_id text)
returns table (player_id text, full_name text, phone text)
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select cp.id,
      coalesce(nullif(btrim(pr.full_name), ''), cp.display_name),
      coalesce(nullif(btrim(pr.phone), ''), nullif(btrim(cp.phone), ''))
    from public.club_players cp
    left join public.profiles pr on pr.auth_user_id = cp.user_id and pr.deleted_at is null
    where cp.tenant_id = p_tenant_id and cp.deleted_at is null;
end;
$$;
revoke all on function public.club_player_contacts(text) from public, anon;
grant execute on function public.club_player_contacts(text) to authenticated;
