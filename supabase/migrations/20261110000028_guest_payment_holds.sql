-- Guest payment holds use the club's configured hold duration.
create or replace function public.set_guest_payment_hold()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.source = 'walk_in' and new.player_id is null and new.paid_at is null
     and new.status in ('pending', 'approved') and new.amount > 0 and new.expires_at is null
     and not exists (select 1 from public.booking_payments p where p.booking_id = new.id and p.deleted_at is null) then
    select now() + make_interval(mins => s.pending_hold_minutes) into new.expires_at
      from public.tenant_settings s where s.tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;
revoke all on function public.set_guest_payment_hold() from public, anon, authenticated;
create trigger guest_payment_hold before insert or update on public.bookings
  for each row execute function public.set_guest_payment_hold();

-- Existing active unpaid guests receive a fresh payment window on rollout.
update public.bookings b
set expires_at = now() + make_interval(mins => s.pending_hold_minutes)
from public.tenant_settings s
where s.tenant_id = b.tenant_id and b.source = 'walk_in' and b.player_id is null
  and b.paid_at is null and b.expires_at is null and b.amount > 0
  and b.status in ('pending', 'approved') and b.deleted_at is null and b.ends_at > now()
  and not exists (select 1 from public.booking_payments p where p.booking_id = b.id and p.deleted_at is null);

create or replace function public.expire_pending_bookings()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    update public.bookings b set status = 'expired'
     where (b.status = 'pending' or (b.status = 'approved' and b.source = 'walk_in' and b.player_id is null and b.paid_at is null)) and b.deleted_at is null
       and b.expires_at is not null and b.expires_at < now()
     returning b.id, b.tenant_id, b.player_id, b.reference_code
  loop
    n := n + 1;
    insert into public.notifications (user_id, tenant_id, type, booking_id, message)
    select cp.user_id, r.tenant_id, 'booking_expired', r.id, r.reference_code
    from public.club_players cp where cp.id = r.player_id;
  end loop;
  return n;
end;
$$;

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
  if b.expires_at is not null and b.expires_at <= now() then raise exception 'booking_expired' using errcode = '22023'; end if;
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
