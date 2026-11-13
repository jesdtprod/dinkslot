-- Guest court settings exclude private payment details until a valid booking token is presented.
create or replace function public.get_guest_booking_info(p_court_id text,p_token_hash text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.courts; t public.tenants; s public.tenant_settings; qrs jsonb := '[]'::jsonb; authorized boolean := false;
begin
  select * into c from public.courts where id=p_court_id and status='active' and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
  select * into t from public.tenants where id=c.tenant_id and status='approved' and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
  select * into s from public.tenant_settings where tenant_id=c.tenant_id and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
  if p_token_hash is not null then
    select exists(select 1 from public.guest_booking_access_tokens a join public.bookings b on b.id=a.booking_id
      where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>now() and b.court_id=c.id
      and b.source='guest_online' and b.status='pending' and b.expires_at>now() and b.deleted_at is null) into authorized;
    if not authorized then raise exception 'not_found'; end if;
  end if;
  if authorized and s.payment_enabled then
    if c.qr_path is not null then qrs:=jsonb_build_array(jsonb_build_object('id','court','kind','court','label','Court QR','account_name',null,'account_number',null,'qr_path',c.qr_path)); end if;
    qrs:=qrs || coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'kind',q.kind,'label',q.label,'account_name',q.account_name,'account_number',q.account_number,'qr_path',q.qr_path) order by q.sort_order,q.created_at) from public.payment_qrs q where q.tenant_id=c.tenant_id and q.is_active and q.deleted_at is null),'[]'::jsonb);
  end if;
  return jsonb_build_object('court_id',c.id,'hourly_rate',c.hourly_rate,'payment_enabled',s.payment_enabled,
    'payment_instructions',case when authorized then s.payment_instructions end,'qrs',qrs,
    'approval_required',s.approval_required,'booking_window_days',s.booking_window_days,'min_hours',s.min_hours,
    'max_hours',s.max_hours,'pending_hold_minutes',s.pending_hold_minutes);
end; $$;
revoke all on function public.get_guest_booking_info(text,text) from public,anon,authenticated;
grant execute on function public.get_guest_booking_info(text,text) to service_role;
