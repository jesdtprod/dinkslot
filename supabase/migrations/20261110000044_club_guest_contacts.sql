-- Only the club's staff can read email addresses for its guest reservations.
create or replace function public.club_guest_booking_contacts(p_tenant_id text)
returns table(booking_id text,email text) language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  if not public.is_tenant_member(p_tenant_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select b.id,g.email from public.bookings b join public.guest_booking_contacts g on g.booking_id=b.id
    where b.tenant_id=p_tenant_id and b.deleted_at is null and b.source='guest_online';
end; $$;
revoke all on function public.club_guest_booking_contacts(text) from public,anon;
grant execute on function public.club_guest_booking_contacts(text) to authenticated;
