-- Keep paid booking policy intact while allowing release of an unpaid checkout hold.
create or replace function public.cancel_booking(
  p_booking_id text, p_reason text default null, p_idempotency_key text default null)
returns public.bookings
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b public.bookings;
  s public.tenant_settings;
  is_admin boolean;
  is_player boolean;
  pl public.club_players;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into b from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  is_admin := public.is_tenant_member(b.tenant_id);
  is_player := public.is_my_player(b.player_id);
  if not is_admin and not is_player then raise exception 'not_found' using errcode = 'P0002'; end if;

  if b.status = 'cancelled' then return b; end if; -- retry-safe
  if b.status not in ('pending','approved') then raise exception 'invalid_state' using errcode = '22023'; end if;

  if is_admin then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'reason_required' using errcode = '22023';
    end if;
  else
    select * into s from public.tenant_settings where tenant_id = b.tenant_id and deleted_at is null;
    -- An active unpaid hold can be released before payment, even on the same day.
    -- Submitted receipts and paid/approved bookings keep the normal cancellation cutoff.
    if not (b.status = 'pending' and b.paid_at is null
            and b.expires_at is not null and b.expires_at > now()
            and b.starts_at > now()
            and not exists (select 1 from public.booking_payments p
                            where p.booking_id = b.id and p.deleted_at is null)) then
      if now() > b.starts_at - make_interval(hours => s.cancel_cutoff_hours) then
        raise exception 'past_cancel_cutoff' using errcode = '22023';
      end if;
    end if;
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_by = uid, cancelled_at = now(), expires_at = null,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = b.id returning * into b;

  perform public._audit(b.tenant_id, 'booking', b.id, 'cancel', null,
                        jsonb_build_object('by_admin', is_admin, 'reason', p_reason));
  if is_admin then
    select * into pl from public.club_players where id = b.player_id;
    if pl.id is not null then
      perform public._notify_user(pl.user_id, b.tenant_id, 'booking_cancelled', b.id, p_reason);
    end if;
  else
    perform public._notify_admins(b.tenant_id, 'booking_cancelled', b.id, b.reference_code);
  end if;
  return b;
end;
$$;
