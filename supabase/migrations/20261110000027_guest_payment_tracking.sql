-- Record guest payments separately from booking approval and uploaded player proof.
alter table public.bookings
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references auth.users(id),
  add column if not exists staff_payment_method text;

create or replace function public.record_guest_payment(p_booking_id text, p_method text)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  b public.bookings;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if not public.is_tenant_member(b.tenant_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if b.player_id is not null or b.source <> 'walk_in' then raise exception 'guest_booking_required' using errcode = '22023'; end if;
  if b.status not in ('pending', 'approved') then raise exception 'invalid_booking_status' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('cash', 'gcash', 'maya', 'bank') then raise exception 'invalid_payment_method' using errcode = '22023'; end if;
  if b.paid_at is not null then return b; end if;
  update public.bookings set paid_at = now(), paid_by = uid, staff_payment_method = p_method,
    status = 'approved', expires_at = null, decided_by = coalesce(decided_by, uid), decided_at = coalesce(decided_at, now())
    where id = b.id returning * into b;
  perform public._audit(b.tenant_id, 'booking', b.id, 'guest_payment_received', null,
    jsonb_build_object('amount', b.amount, 'method', p_method));
  return b;
end;
$$;
revoke all on function public.record_guest_payment(text, text) from public, anon;
grant execute on function public.record_guest_payment(text, text) to authenticated;
