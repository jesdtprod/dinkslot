-- Soft delete through functions: a direct "set deleted_at" UPDATE fails RLS because the new
-- row would no longer satisfy the SELECT policy (deleted rows are hidden). Functions check
-- membership first, and refuse to delete a court that still holds upcoming bookings.

revoke update (deleted_at) on public.courts from authenticated;
revoke update (deleted_at) on public.court_blocks from authenticated;

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
  perform public._audit(c.tenant_id, 'court', c.id, 'delete', to_jsonb(c), null);
end;
$$;

create or replace function public.delete_court_block(p_block_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  k public.court_blocks;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into k from public.court_blocks where id = p_block_id and deleted_at is null for update;
  if not found or not public.is_tenant_member(k.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.court_blocks set deleted_at = now() where id = k.id;
  perform public._audit(k.tenant_id, 'court_block', k.id, 'delete', to_jsonb(k), null);
end;
$$;

revoke all on function public.delete_court(text), public.delete_court_block(text) from public, anon, authenticated;
grant execute on function public.delete_court(text), public.delete_court_block(text) to authenticated;
