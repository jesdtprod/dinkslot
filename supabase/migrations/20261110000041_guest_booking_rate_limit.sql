-- Serialize guest reservation attempts by a one-way identifier to limit abuse.
create table public.guest_booking_attempts (
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now()
);
create index guest_booking_attempts_subject_time on public.guest_booking_attempts(subject_hash, attempted_at);
alter table public.guest_booking_attempts enable row level security;
revoke all on public.guest_booking_attempts from public, anon, authenticated;

create or replace function public.claim_guest_booking_attempt(p_subject_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_subject_hash, 47));
  delete from public.guest_booking_attempts where subject_hash=p_subject_hash and attempted_at < now() - interval '1 hour';
  if (select count(*) from public.guest_booking_attempts where subject_hash=p_subject_hash) >= 5 then return false; end if;
  insert into public.guest_booking_attempts(subject_hash) values(p_subject_hash);
  return true;
end;
$$;
revoke all on function public.claim_guest_booking_attempt(text) from public, anon, authenticated;
grant execute on function public.claim_guest_booking_attempt(text) to service_role;
