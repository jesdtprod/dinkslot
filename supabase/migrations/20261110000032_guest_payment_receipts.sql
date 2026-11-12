-- Staff can upload guest receipts only within their own club and user folder.
create policy payment_staff_guest_proof_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment' and (storage.foldername(name))[2] = 'guest-proofs'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.is_tenant_member((storage.foldername(name))[1]));

-- Remove the old overload so electronic methods cannot bypass receipt validation.
drop function public.record_guest_payment(text, text);
create or replace function public.record_guest_payment(p_booking_id text, p_method text, p_proof_path text default null)
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
  if p_method <> 'cash' then
    if p_proof_path is null then raise exception 'proof_required' using errcode = '22023'; end if;
    if split_part(p_proof_path, '/', 1) <> b.tenant_id or split_part(p_proof_path, '/', 2) <> 'guest-proofs'
       or split_part(p_proof_path, '/', 3) <> uid::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'payment' and o.name = p_proof_path) then
      raise exception 'invalid_proof_path' using errcode = '22023';
    end if;
    insert into public.booking_payments (tenant_id, booking_id, proof_path, payer_reference, method)
      values (b.tenant_id, b.id, p_proof_path, null, p_method);
  end if;
  update public.bookings set paid_at = now(), paid_by = uid, staff_payment_method = p_method,
    status = 'approved', expires_at = null, decided_by = coalesce(decided_by, uid), decided_at = coalesce(decided_at, now())
    where id = b.id returning * into b;
  perform public._audit(b.tenant_id, 'booking', b.id, 'guest_payment_received', null,
    jsonb_build_object('amount', b.amount, 'method', p_method));
  return b;
end;
$$;
revoke all on function public.record_guest_payment(text, text, text) from public, anon;
grant execute on function public.record_guest_payment(text, text, text) to authenticated;
