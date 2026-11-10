-- Stage 8: per-user rate limits on write actions, enforced in Postgres.
-- Fixed-window counters in a private table, checked by BEFORE triggers so the existing
-- functions stay untouched and direct table writes are covered too.
-- Only authenticated end users are limited (auth.uid() is set); service role and migrations are not.
-- A failed attempt rolls its own counter back, so limits count successful writes; cheap failed
-- calls are handled by Supabase's API-level limits.

create table public.rate_limits (
  bucket     text primary key,
  count      int not null default 0,
  expires_at timestamptz not null
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
-- no policies, no grants

create or replace function public._rate_limit(p_key text, p_max int, p_window_seconds int)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b text := p_key || ':' || (extract(epoch from now())::bigint / p_window_seconds)::text;
  c int;
begin
  insert into public.rate_limits (bucket, count, expires_at)
  values (b, 1, now() + make_interval(secs => p_window_seconds * 2))
  on conflict (bucket) do update set count = public.rate_limits.count + 1
  returning count into c;
  if c > p_max then
    raise exception 'rate_limited' using errcode = '54000', hint = 'Too many requests. Try again later.';
  end if;
end;
$$;
revoke all on function public._rate_limit(text, int, int) from public, anon, authenticated;

create or replace function public.rate_limit_trigger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
-- args: 0 = key prefix, 1 = max, 2 = window seconds, 3 = optional condition ('cancelled' or 'decided')
declare
  uid uuid := auth.uid();
begin
  if uid is null then return new; end if; -- service role / migrations are not limited
  if tg_nargs >= 4 then
    if tg_argv[3] = 'cancelled' and not (tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled') then return new; end if;
    if tg_argv[3] = 'decided' and not (tg_op = 'UPDATE' and new.status in ('approved', 'rejected') and old.status = 'pending') then return new; end if;
  end if;
  perform public._rate_limit(tg_argv[0] || ':' || uid::text, tg_argv[1]::int, tg_argv[2]::int);
  return new;
end;
$$;
revoke all on function public.rate_limit_trigger() from public, anon, authenticated;

-- limits per user (see docs/stage8.md)
create trigger rl_bookings_insert  before insert on public.bookings         for each row execute function public.rate_limit_trigger('booking', '30', '3600');
create trigger rl_bookings_cancel  before update on public.bookings         for each row execute function public.rate_limit_trigger('cancel', '30', '3600', 'cancelled');
create trigger rl_bookings_decide  before update on public.bookings         for each row execute function public.rate_limit_trigger('decide', '300', '3600', 'decided');
create trigger rl_payments_insert  before insert on public.booking_payments for each row execute function public.rate_limit_trigger('proof', '30', '3600');
create trigger rl_players_insert   before insert on public.club_players     for each row execute function public.rate_limit_trigger('join', '10', '3600');
create trigger rl_tenants_insert   before insert on public.tenants          for each row execute function public.rate_limit_trigger('club', '5', '86400');
create trigger rl_members_insert   before insert on public.tenant_members   for each row execute function public.rate_limit_trigger('staff', '30', '3600');
create trigger rl_courts_insert    before insert on public.courts           for each row execute function public.rate_limit_trigger('court', '60', '3600');
create trigger rl_blocks_insert    before insert on public.court_blocks     for each row execute function public.rate_limit_trigger('block', '100', '3600');

-- housekeeping: drop expired counters every 15 minutes
select cron.schedule('purge-rate-limits', '*/15 * * * *', $$delete from public.rate_limits where expires_at < now()$$);
