-- Fixed payment QR slots. Every club gets 9 ready-made cards, all INACTIVE until set up:
--   3 GCash, 3 Maya and 3 Bank account. One card = one account.
-- The owner fills in the details, uploads the QR image and switches the card on.
-- Replaces the "add any QR" model of migrations 0018 and 0019 (no rows existed in production).

-- tidy anything left over from the earlier model
update public.payment_qrs set kind = 'gcash' where kind = 'card';
update public.payment_qrs set deleted_at = coalesce(deleted_at, now()), is_active = false;

drop trigger if exists limit_payment_qrs on public.payment_qrs;
drop function if exists public.limit_payment_qrs();
alter table public.payment_qrs drop constraint if exists payment_qrs_no_card_number;
alter table public.payment_qrs drop constraint if exists payment_qrs_kind_check;
alter table public.payment_qrs add constraint payment_qrs_kind_check check (kind in ('gcash', 'maya', 'bank'));

alter table public.payment_qrs add column slot int not null default 1 check (slot between 1 and 3);
create unique index payment_qrs_slot_unique on public.payment_qrs (tenant_id, kind, slot) where deleted_at is null;

-- a card can exist without an image; it can only be ACTIVE once it has one
alter table public.payment_qrs alter column qr_path drop not null;
alter table public.payment_qrs drop constraint if exists payment_qrs_qr_path_check;
alter table public.payment_qrs add constraint payment_qrs_qr_path_check
  check (qr_path is null or (qr_path like tenant_id || '/qr/%' and qr_path !~ '\.\.'));
alter table public.payment_qrs add constraint payment_qrs_active_needs_image
  check (not is_active or qr_path is not null);

-- the owner edits cards; nobody adds or removes them (the slots are fixed)
drop policy if exists payment_qrs_insert on public.payment_qrs;
revoke insert on public.payment_qrs from authenticated;
drop function if exists public.delete_payment_qr(text);

create or replace function public.seed_payment_qrs(p_tenant_id text)
returns void
language sql security definer
set search_path = public
as $$
  insert into public.payment_qrs (tenant_id, kind, slot, label, is_active, sort_order)
  select p_tenant_id, k.kind, s.n, k.name || ' ' || s.n, false, k.ord * 10 + s.n
  from (values ('gcash', 'GCash', 1), ('maya', 'Maya', 2), ('bank', 'Bank account', 3)) as k(kind, name, ord),
       generate_series(1, 3) as s(n)
  on conflict (tenant_id, kind, slot) where deleted_at is null do nothing;
$$;
revoke all on function public.seed_payment_qrs(text) from public, anon, authenticated;

create or replace function public.seed_payment_qrs_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.seed_payment_qrs(new.id);
  return new;
end;
$$;
revoke all on function public.seed_payment_qrs_trigger() from public, anon, authenticated;
create trigger seed_payment_qrs after insert on public.tenants
  for each row execute function public.seed_payment_qrs_trigger();

-- every existing club gets its 9 cards now
select public.seed_payment_qrs(t.id) from public.tenants t where t.deleted_at is null;

-- empty a card (details, image and switch). Returns the old image path so the browser can remove the file.
create or replace function public.clear_payment_qr(p_id text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  q public.payment_qrs;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into q from public.payment_qrs where id = p_id and deleted_at is null for update;
  if not found or not public.is_tenant_owner(q.tenant_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.payment_qrs
     set label = (case q.kind when 'gcash' then 'GCash' when 'maya' then 'Maya' else 'Bank account' end) || ' ' || q.slot,
         account_name = null, account_number = null, qr_path = null, is_active = false
   where id = q.id;
  perform public._audit(q.tenant_id, 'payment_qr', q.id, 'clear', to_jsonb(q), null);
  return q.qr_path;
end;
$$;
revoke all on function public.clear_payment_qr(text) from public, anon, authenticated;
grant execute on function public.clear_payment_qr(text) to authenticated;
