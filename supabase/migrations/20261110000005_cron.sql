-- DINKSLOT Stage 2 / 5: expire unpaid pending bookings every minute.
create extension if not exists pg_cron;

select cron.schedule('expire-pending-bookings', '* * * * *', $$select public.expire_pending_bookings()$$);
