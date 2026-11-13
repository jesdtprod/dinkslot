-- Trusted service endpoint supplies a SHA-256 token hash; no anonymous direct RPC access.
create or replace function public.attach_guest_payment_proof(p_token_hash text, p_proof_path text, p_idempotency_key text, p_method text)
returns text language plpgsql security definer set search_path=public as $$
declare b public.bookings; s public.tenant_settings; existing public.booking_payments; folders text[];
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then raise exception 'invalid_request'; end if;
  select booking.* into b from public.bookings booking join public.guest_booking_access_tokens token on token.booking_id=booking.id
    where token.token_hash=p_token_hash and token.revoked_at is null and token.expires_at>now() and booking.source='guest_online' and booking.deleted_at is null for update of booking;
  if not found then raise exception 'not_found'; end if;
  select * into existing from public.booking_payments where booking_id=b.id and idempotency_key=p_idempotency_key and deleted_at is null;
  if found then return existing.id; end if;
  if b.status<>'pending' or b.expires_at is null or b.expires_at<=now() then raise exception 'invalid_state'; end if;
  select * into s from public.tenant_settings where tenant_id=b.tenant_id and deleted_at is null;
  if not found or not s.payment_enabled then raise exception 'payment_disabled'; end if;
  folders:=string_to_array(p_proof_path,'/');
  if array_length(folders,1)<>4 or folders[1]<>b.tenant_id or folders[2]<>'guest-proofs' or folders[3]<>b.id then raise exception 'invalid_proof_path'; end if;
  update public.booking_payments set deleted_at=now() where booking_id=b.id and deleted_at is null;
  insert into public.booking_payments(tenant_id,booking_id,proof_path,idempotency_key,method)
    values(b.tenant_id,b.id,p_proof_path,p_idempotency_key,nullif(left(btrim(coalesce(p_method,'')),40),'')) returning * into existing;
  if s.approval_required then update public.bookings set expires_at=null where id=b.id;
  else update public.bookings set expires_at=null,status='approved',decided_at=now() where id=b.id; end if;
  perform public._audit(b.tenant_id,'booking_payment',existing.id,'attach_proof',null,jsonb_build_object('booking_id',b.id,'method',existing.method));
  perform public._notify_admins(b.tenant_id,'proof_uploaded',b.id,b.reference_code);
  return existing.id;
end; $$;
revoke all on function public.attach_guest_payment_proof(text,text,text,text) from public,anon,authenticated;
grant execute on function public.attach_guest_payment_proof(text,text,text,text) to service_role;
