-- Payment QR codes get a TYPE with a limit per type:
--   up to 3 GCash, 3 Maya, 3 Card and 3 Bank account QR codes per club (one QR per account).
-- Replaces the flat "8 per club" limit from migration 0018.

alter table public.payment_qrs
  add column kind text not null default 'gcash' check (kind in ('gcash', 'maya', 'card', 'bank'));

-- never store a full card number: a card entry may carry a name or the last digits only
alter table public.payment_qrs
  add constraint payment_qrs_no_card_number
  check (kind <> 'card' or account_number is null or regexp_replace(account_number, '\D', '', 'g') !~ '^[0-9]{12,}$');

drop trigger if exists limit_payment_qrs on public.payment_qrs;
drop function if exists public.limit_payment_qrs();

create or replace function public.limit_payment_qrs()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.payment_qrs
       where tenant_id = new.tenant_id and kind = new.kind and deleted_at is null) >= 3 then
    raise exception 'too_many_qrs' using errcode = '22023', detail = new.kind;
  end if;
  return new;
end;
$$;
revoke all on function public.limit_payment_qrs() from public, anon, authenticated;
create trigger limit_payment_qrs before insert on public.payment_qrs
  for each row execute function public.limit_payment_qrs();

-- the type can be chosen when adding, but not changed later (keeps the per-type limits honest)
grant insert (kind) on public.payment_qrs to authenticated;

create or replace function public.guard_payment_qr_kind()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'qr_kind_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_payment_qr_kind before update on public.payment_qrs
  for each row execute function public.guard_payment_qr_kind();

-- players see the type too (used for the checkout tabs)
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
