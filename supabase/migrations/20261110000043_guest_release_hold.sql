-- Release only active, unpaid guest holds; paid or submitted reservations remain protected.
create or replace function public.release_guest_booking(p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare b public.bookings;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not_found'; end if;
  select booking.* into b from public.bookings booking join public.guest_booking_access_tokens token on token.booking_id=booking.id
    where token.token_hash=p_token_hash and token.revoked_at is null and token.expires_at>now()
      and booking.source='guest_online' and booking.deleted_at is null for update of booking;
  if not found then raise exception 'not_found'; end if;
  if b.status='cancelled' then return true; end if;
  if b.status<>'pending' or b.paid_at is not null or b.expires_at is null or b.expires_at<=now() or b.starts_at<=now()
     or exists(select 1 from public.booking_payments p where p.booking_id=b.id and p.deleted_at is null) then
    raise exception 'cannot_release';
  end if;
  update public.bookings set status='cancelled', cancelled_at=now(), expires_at=null, cancel_reason='Guest released unpaid hold' where id=b.id;
  perform public._audit(b.tenant_id,'booking',b.id,'cancel',null,jsonb_build_object('source','guest_online'));
  perform public._notify_admins(b.tenant_id,'booking_cancelled',b.id,b.reference_code);
  return true;
end; $$;
revoke all on function public.release_guest_booking(text) from public,anon,authenticated;
grant execute on function public.release_guest_booking(text) to service_role;
