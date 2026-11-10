-- Several payment QR codes per club (GCash, Maya, bank...), each switchable active / inactive.
-- Players see only the ACTIVE ones at checkout and say which one they paid with.
-- Files stay in the private `payment` bucket under <tenant_id>/qr/ (existing storage policies apply).

create table public.payment_qrs (
  id             text primary key default public.gen_ulid(),
  tenant_id      text not null references public.tenants (id),
  label          text not null check (char_length(btrim(label)) between 1 and 40),
  account_name   text check (account_name is null or char_length(account_name) <= 80),
  account_number text check (account_number is null or char_length(account_number) <= 60),
  qr_path        text not null check (qr_path like tenant_id || '/qr/%' and qr_path !~ '\.\.'),
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index payment_qrs_tenant_idx on public.payment_qrs (tenant_id) where deleted_at is null;

alter table public.payment_qrs enable row level security;
alter table public.payment_qrs force row level security;

-- only the club owner manages payment methods; players read them through get_booking_info()
create policy payment_qrs_select on public.payment_qrs for select to authenticated
  using (deleted_at is null and (public.is_tenant_owner(tenant_id) or public.is_platform_admin()));
create policy payment_qrs_insert on public.payment_qrs for insert to authenticated
  with check (deleted_at is null and public.is_tenant_owner(tenant_id));
create policy payment_qrs_update on public.payment_qrs for update to authenticated
  using (public.is_tenant_owner(tenant_id)) with check (public.is_tenant_owner(tenant_id));

grant select on public.payment_qrs to authenticated;
grant insert (tenant_id, label, account_name, account_number, qr_path, is_active, sort_order) on public.payment_qrs to authenticated;
grant update (label, account_name, account_number, qr_path, is_active, sort_order) on public.payment_qrs to authenticated;

create trigger set_updated_at before update on public.payment_qrs
  for each row execute function public.set_updated_at();
create trigger forbid_hard_delete before delete on public.payment_qrs
  for each row execute function public.forbid_hard_delete();

-- at most 8 payment methods per club
create or replace function public.limit_payment_qrs()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.payment_qrs where tenant_id = new.tenant_id and deleted_at is null) >= 8 then
    raise exception 'too_many_qrs' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger limit_payment_qrs before insert on public.payment_qrs
  for each row execute function public.limit_payment_qrs();

-- soft delete through a function (a direct "set deleted_at" would fail the SELECT policy)
create or replace function public.delete_payment_qr(p_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  q public.payment_qrs;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into q from public.payment_qrs where id = p_id and deleted_at is null for update;
  if not found or not public.is_tenant_owner(q.tenant_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.payment_qrs set deleted_at = now(), is_active = false where id = q.id;
  perform public._audit(q.tenant_id, 'payment_qr', q.id, 'delete', to_jsonb(q), null);
end;
$$;
revoke all on function public.delete_payment_qr(text), public.limit_payment_qrs() from public, anon, authenticated;
grant execute on function public.delete_payment_qr(text) to authenticated;

-- the existing single QR becomes the first payment method
insert into public.payment_qrs (tenant_id, label, qr_path, sort_order)
select s.tenant_id, 'Payment QR', s.qr_path, 0
from public.tenant_settings s
where s.qr_path is not null and s.deleted_at is null and s.qr_path like s.tenant_id || '/qr/%';

-- ------------------------------------------------------------- which method was used
alter table public.booking_payments
  add column method text check (method is null or char_length(method) <= 40);

drop function if exists public.attach_payment_proof(text, text, text, text);
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
    values (b.tenant_id, b.id, p_proof_path, btrim(p_payer_reference), p_idempotency_key, nullif(left(btrim(coalesce(p_method, '')), 40), ''))
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
revoke all on function public.attach_payment_proof(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.attach_payment_proof(text, text, text, text, text) to authenticated;

-- ------------------------------------------------------ booking screen: all active QR codes
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
    if c.qr_path is not null then  -- a court's own QR is offered first
      qrs := jsonb_build_array(jsonb_build_object('id', 'court', 'label', 'Court QR', 'account_name', null,
                                                   'account_number', null, 'qr_path', c.qr_path));
    end if;
    qrs := qrs || coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'account_name', q.account_name,
                                          'account_number', q.account_number, 'qr_path', q.qr_path)
                       order by q.sort_order, q.created_at)
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
