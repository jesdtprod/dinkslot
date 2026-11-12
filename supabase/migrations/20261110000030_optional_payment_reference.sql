-- Receipt image and booking linkage remain required; a separate transaction reference is optional.
alter table public.booking_payments alter column payer_reference drop not null;

create or replace function public.attach_payment_proof(
  p_booking_id text, p_proof_path text, p_payer_reference text, p_idempotency_key text, p_method text default null)
returns public.booking_payments
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  b public.bookings;
  s public.tenant_settings;
  pay public.booking_payments;
  folders text[];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking_id and deleted_at is null for update;
  if not found or not public.is_my_player(b.player_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into pay from public.booking_payments
   where booking_id = b.id and idempotency_key = p_idempotency_key;
  if found then return pay; end if;

  if b.status <> 'pending' then raise exception 'invalid_state' using errcode = '22023'; end if;
  select * into s from public.tenant_settings where tenant_id = b.tenant_id and deleted_at is null;
  if not s.payment_enabled then raise exception 'payment_disabled' using errcode = '22023'; end if;

  folders := string_to_array(p_proof_path, '/');
  if array_length(folders, 1) < 4 or folders[1] <> b.tenant_id or folders[2] <> 'proofs'
     or folders[3] <> uid::text then
    raise exception 'invalid_proof_path' using errcode = '22023';
  end if;

  update public.booking_payments set deleted_at = now() where booking_id = b.id and deleted_at is null;
  begin
    insert into public.booking_payments (tenant_id, booking_id, proof_path, payer_reference, idempotency_key, method)
    values (b.tenant_id, b.id, p_proof_path, nullif(btrim(p_payer_reference), ''), p_idempotency_key, nullif(left(btrim(coalesce(p_method, '')), 40), ''))
    returning * into pay;
  exception
    when unique_violation then raise exception 'payer_reference_already_used' using errcode = '23505';
    when check_violation then raise exception 'invalid_payer_reference' using errcode = '23514';
  end;

  if s.approval_required then
    update public.bookings set expires_at = null where id = b.id;
  else
    update public.bookings set expires_at = null, status = 'approved', decided_at = now() where id = b.id;
  end if;

  perform public._audit(b.tenant_id, 'booking_payment', pay.id, 'attach_proof', null,
                        jsonb_build_object('booking_id', b.id, 'method', pay.method));
  perform public._notify_admins(b.tenant_id, 'proof_uploaded', b.id, b.reference_code);
  return pay;
end;
$$;
revoke all on function public.attach_payment_proof(text,text,text,text,text) from public, anon;
grant execute on function public.attach_payment_proof(text,text,text,text,text) to authenticated;
