-- Stage 7: notifications.
-- 1) Super admin is notified when a club registers.
-- 2) Booking changes call the send-booking-email Edge Function through pg_net.
--    The function URL and shared secret live in Supabase Vault (never in the repo):
--      vault secret "edge_base_url"           e.g. https://<ref>.supabase.co/functions/v1
--      vault secret "booking_webhook_secret"  random value, also set as Edge secret WEBHOOK_SECRET
--      vault secret "edge_anon_key"           the PUBLIC anon key, sent as the Bearer token so the
--                                             function keeps Supabase JWT verification ON
--    The function authenticates the caller with the shared secret as well (defense in depth).
--    If either is missing the trigger does nothing, so bookings never depend on email.

create extension if not exists pg_net;

-- ----------------------------------------------- new club -> notify platform admins
create or replace function public.notify_platform_new_club()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, tenant_id, type, message)
  select p.auth_user_id, new.id, 'club_registered', new.name
  from public.profiles p
  where p.is_platform_admin and p.deleted_at is null;
  return new;
end;
$$;

create trigger notify_platform_new_club
  after insert on public.tenants
  for each row execute function public.notify_platform_new_club();

-- ------------------------------------------------ booking -> email webhook (async)
create or replace function public.booking_email_webhook()
returns trigger
language plpgsql security definer
set search_path = public, vault, net
as $$
declare
  base text;
  sec text;
  anon text;
begin
  -- only real status changes (and new bookings) produce email
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  begin
    select decrypted_secret into base from vault.decrypted_secrets where name = 'edge_base_url' limit 1;
    select decrypted_secret into sec  from vault.decrypted_secrets where name = 'booking_webhook_secret' limit 1;
    select decrypted_secret into anon from vault.decrypted_secrets where name = 'edge_anon_key' limit 1;
    if base is null or sec is null or anon is null then return new; end if;
    perform net.http_post(
      url := rtrim(base, '/') || '/send-booking-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon,
                                    'x-webhook-secret', sec),
      body := jsonb_build_object('type', tg_op, 'table', 'bookings', 'record', to_jsonb(new),
                                 'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) end)
    );
  exception when others then
    -- never block a booking because the email hook failed
    raise warning 'booking_email_webhook failed: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger booking_email_webhook
  after insert or update on public.bookings
  for each row execute function public.booking_email_webhook();
