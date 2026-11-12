-- Preserve current grouped payment account metadata after optional receipt references.
create or replace function public.get_booking_info(p_court_id text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  c public.courts;
  s public.tenant_settings;
  qrs jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into c from public.courts where id = p_court_id and status = 'active' and deleted_at is null;
  if not found or not public.is_club_player(c.tenant_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.tenant_settings where tenant_id = c.tenant_id and deleted_at is null;

  if s.payment_enabled then
    if c.qr_path is not null then
      qrs := jsonb_build_array(jsonb_build_object('id', 'court', 'kind', 'court', 'label', 'Court QR', 'account_name', null,
                                                   'account_number', null, 'qr_path', c.qr_path));
    end if;
    qrs := qrs || coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'label', q.label, 'account_name', q.account_name,
                                          'account_number', q.account_number, 'qr_path', q.qr_path)
                       order by case q.kind when 'gcash' then 1 when 'maya' then 2 when 'bank' then 3 else 4 end, q.sort_order, q.created_at)
      from public.payment_qrs q
      where q.tenant_id = c.tenant_id and q.is_active and q.deleted_at is null), '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'court_id', c.id, 'hourly_rate', c.hourly_rate,
    'payment_enabled', s.payment_enabled,
    'payment_instructions', case when s.payment_enabled then s.payment_instructions end,
    'qr_path', qrs -> 0 ->> 'qr_path',
    'qrs', qrs,
    'approval_required', s.approval_required,
    'booking_window_days', s.booking_window_days,
    'min_hours', s.min_hours, 'max_hours', s.max_hours,
    'cancel_cutoff_hours', s.cancel_cutoff_hours,
    'pending_hold_minutes', s.pending_hold_minutes);
end;
$$;
revoke all on function public.get_booking_info(text) from public, anon, authenticated;
grant execute on function public.get_booking_info(text) to authenticated;
