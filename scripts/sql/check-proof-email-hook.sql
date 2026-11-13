-- Verify the upload acknowledgement trigger without sending an email or keeping
-- any booking changes. pg_net dispatches only after commit; this test rolls back.
begin;
do $$
declare
  target_booking_id text;
  before_count bigint;
  after_count bigint;
begin
  select b.id into target_booking_id from public.bookings b
  where b.status = 'pending' and b.deleted_at is null and b.starts_at > now()
    and exists (select 1 from public.booking_payments p
                where p.booking_id = b.id and p.deleted_at is null and p.proof_path is not null)
  limit 1 for update;
  if target_booking_id is null then raise exception 'A future pending booking with proof is required for this rollback test'; end if;

  update public.bookings set expires_at = now() + interval '30 minutes' where id = target_booking_id;
  select count(*) into before_count from net.http_request_queue q
  where convert_from(q.body, 'UTF8')::jsonb ->> 'event' = 'payment_proof_received'
    and convert_from(q.body, 'UTF8')::jsonb -> 'record' ->> 'id' = target_booking_id;

  update public.bookings set expires_at = null where id = target_booking_id;
  select count(*) into after_count from net.http_request_queue q
  where convert_from(q.body, 'UTF8')::jsonb ->> 'event' = 'payment_proof_received'
    and convert_from(q.body, 'UTF8')::jsonb -> 'record' ->> 'id' = target_booking_id;
  if after_count <> before_count + 1 then raise exception 'Missing proof acknowledgement event'; end if;

  update public.bookings set expires_at = null where id = target_booking_id;
  select count(*) into after_count from net.http_request_queue q
  where convert_from(q.body, 'UTF8')::jsonb ->> 'event' = 'payment_proof_received'
    and convert_from(q.body, 'UTF8')::jsonb -> 'record' ->> 'id' = target_booking_id;
  if after_count <> before_count + 1 then raise exception 'Repeated unchanged update queued another acknowledgement'; end if;

  update public.booking_payments p set deleted_at = now() where p.booking_id = target_booking_id and p.deleted_at is null;
  update public.bookings set expires_at = now() + interval '30 minutes' where id = target_booking_id;
  update public.bookings set expires_at = null where id = target_booking_id;
  select count(*) into after_count from net.http_request_queue q
  where convert_from(q.body, 'UTF8')::jsonb ->> 'event' = 'payment_proof_received'
    and convert_from(q.body, 'UTF8')::jsonb -> 'record' ->> 'id' = target_booking_id;
  if after_count <> before_count + 1 then raise exception 'Proofless booking queued an acknowledgement'; end if;
end;
$$;
rollback;
select 'Proof event, unchanged-update suppression, and proof validation passed; all changes rolled back.' as result;
