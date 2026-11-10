-- Super admin (platform admin) allowlist. A user becomes platform admin only when an
-- allowlisted email is CONFIRMED, so nobody can claim it by merely signing up with it.
-- Requires Auth email confirmation to be on.

create table public.platform_admin_emails (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.platform_admin_emails enable row level security;
alter table public.platform_admin_emails force row level security;
-- No policies, no grants: not readable or writable by clients.

insert into public.platform_admin_emails (email) values ('dinkslot2026@gmail.com');

create or replace function public.sync_platform_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and exists (
       select 1 from public.platform_admin_emails e where e.email = lower(new.email)) then
    update public.profiles set is_platform_admin = true
     where auth_user_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$$;

-- Fires after the profile row exists (profile trigger is created on insert too).
create trigger zz_sync_platform_admin_ins
  after insert on auth.users
  for each row execute function public.sync_platform_admin();
create trigger zz_sync_platform_admin_upd
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.sync_platform_admin();

-- If the account already exists and is confirmed, promote it now.
update public.profiles p set is_platform_admin = true
  from auth.users u
 where u.id = p.auth_user_id and u.email_confirmed_at is not null
   and lower(u.email) in (select email from public.platform_admin_emails);
