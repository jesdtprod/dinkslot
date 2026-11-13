-- Run only in an isolated transaction. All bookings, notifications, and queued webhooks roll back.
begin;
set local statement_timeout = '30s';
do $$
declare
  candidate record; first_booking public.bookings; retried public.bookings; second_booking public.bookings;
  token_a text := encode(extensions.gen_random_bytes(32),'hex');
  token_b text := encode(extensions.gen_random_bytes(32),'hex');
  attempt_a text := encode(extensions.gen_random_bytes(16),'hex');
  attempt_b text := encode(extensions.gen_random_bytes(16),'hex');
  info jsonb; proof_id text;
begin
  select c.id,c.tenant_id,c.slot_minutes,s.approval_required,
    ((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone) as starts,
    (ceil(s.min_hours*60/c.slot_minutes)::int*c.slot_minutes) as duration_minutes
  into candidate
  from public.courts c join public.tenants t on t.id=c.tenant_id join public.tenant_settings s on s.tenant_id=t.id
  cross join lateral generate_series(0,least(5,s.booking_window_days)) as d(day_no)
  cross join lateral generate_series(0,95) as ticks(n)
  where c.status='active' and c.deleted_at is null and t.status='approved' and t.deleted_at is null and s.deleted_at is null
    and s.payment_enabled and s.pending_hold_minutes>0
    and (ticks.n*c.slot_minutes + ceil(s.min_hours*60/c.slot_minutes)*c.slot_minutes) <=
      (case when c.close_time=time '00:00' then 1440 else extract(epoch from c.close_time)/60 end - extract(epoch from c.open_time)/60)
    and ((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone) > now()+interval '10 minutes'
    and ((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone) <= now()+make_interval(days=>s.booking_window_days)
    and not exists (select 1 from public.bookings existing where existing.court_id=c.id and existing.deleted_at is null and existing.status in ('pending','approved')
      and existing.starts_at < (((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone)+make_interval(mins=>ceil(s.min_hours*60/c.slot_minutes)::int*c.slot_minutes))
      and existing.ends_at > ((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone))
    and not exists (select 1 from public.court_blocks blocked where blocked.court_id=c.id and blocked.deleted_at is null
      and blocked.starts_at < (((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone)+make_interval(mins=>ceil(s.min_hours*60/c.slot_minutes)::int*c.slot_minutes))
      and blocked.ends_at > ((date_trunc('day',now() at time zone t.timezone)+make_interval(days=>d.day_no)+c.open_time+make_interval(mins=>ticks.n*c.slot_minutes)) at time zone t.timezone))
  order by d.day_no,ticks.n limit 1;
  if candidate.id is null then raise exception 'No suitable active court and free test slot'; end if;
  first_booking := public.create_guest_booking(candidate.id,candidate.starts,candidate.starts+make_interval(mins=>candidate.duration_minutes),attempt_a,'Test Guest','09123456789','guest-test@example.invalid',token_a,now()+interval '30 days');
  retried := public.create_guest_booking(candidate.id,candidate.starts,candidate.starts+make_interval(mins=>candidate.duration_minutes),attempt_a,'Test Guest','09123456789','guest-test@example.invalid',token_a,now()+interval '30 days');
  if first_booking.id<>retried.id or first_booking.status<>'pending' then raise exception 'Guest creation or idempotency failed'; end if;
  info:=public.get_guest_booking_info(candidate.id,null);
  if jsonb_array_length(info->'qrs')<>0 or info->>'payment_instructions' is not null then raise exception 'Public booking information leaked payment details'; end if;
  info:=public.get_guest_booking_info(candidate.id,token_a);
  if info->>'court_id'<>candidate.id then raise exception 'Guest token checkout lookup failed'; end if;
  if not public.release_guest_booking(token_a) then raise exception 'Unpaid guest hold release failed'; end if;
  second_booking := public.create_guest_booking(candidate.id,candidate.starts,candidate.starts+make_interval(mins=>candidate.duration_minutes),attempt_b,'Test Guest','09123456789','guest-test@example.invalid',token_b,now()+interval '30 days');
  proof_id:=public.attach_guest_payment_proof(token_b,candidate.tenant_id||'/guest-proofs/'||second_booking.id||'/test.png',attempt_b,'GCash');
  if proof_id is null then raise exception 'Guest proof submission failed'; end if;
  begin
    perform public.release_guest_booking(token_b);
    raise exception 'Submitted guest payment could be released';
  exception when others then
    if sqlerrm <> 'cannot_release' then raise; end if;
  end;
end $$;
rollback;
