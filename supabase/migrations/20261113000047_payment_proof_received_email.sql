-- Uploading proof clears the pending hold, but does not change the booking
-- status when approval is required. Send a distinct, idempotent acknowledgement.
create or replace function public.booking_email_webhook()
returns trigger
language plpgsql security definer
set search_path = public, vault, net
as $$
declare
  base text;
  sec text;
  anon text;
  event_name text := null;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    if new.status = 'pending' and old.expires_at is not null and new.expires_at is null
       and exists (select 1 from public.booking_payments p
                   where p.booking_id = new.id and p.deleted_at is null and p.proof_path is not null) then
      event_name := 'payment_proof_received';
    else
      return new;
    end if;
  end if;
  begin
    select decrypted_secret into base from vault.decrypted_secrets where name = 'edge_base_url' limit 1;
    select decrypted_secret into sec from vault.decrypted_secrets where name = 'booking_webhook_secret' limit 1;
    select decrypted_secret into anon from vault.decrypted_secrets where name = 'edge_anon_key' limit 1;
    if base is null or sec is null or anon is null then return new; end if;
    perform net.http_post(
      url := rtrim(base, '/') || '/send-booking-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon,
                                    'x-webhook-secret', sec),
      body := jsonb_build_object('type', tg_op, 'table', 'bookings', 'event', event_name,
                                'record', to_jsonb(new),
                                'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end),
      timeout_milliseconds := 15000
    );
  exception when others then
    raise warning 'booking_email_webhook failed: %', sqlerrm;
  end;
  return new;
end;
$$;
