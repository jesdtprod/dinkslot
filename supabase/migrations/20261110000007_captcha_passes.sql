-- Stage 3: Turnstile enforcement for club registration.
-- The verify-turnstile Edge Function (service role) records a one-time pass after Cloudflare
-- confirms the token. register_club consumes a pass, so it cannot be called without CAPTCHA.
-- Sign-up / sign-in CAPTCHA is enforced by Supabase Auth itself (Attack Protection).

create table public.captcha_passes (
  id         text primary key default public.gen_ulid(),
  user_id    uuid not null references auth.users (id),
  purpose    text not null check (purpose in ('register_club')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index captcha_passes_lookup on public.captcha_passes (user_id, purpose) where used_at is null;

alter table public.captcha_passes enable row level security;
alter table public.captcha_passes force row level security;
-- No policies and no grants: clients can never read or write passes.
create trigger set_updated_at before update on public.captcha_passes
  for each row execute function public.set_updated_at();
create trigger forbid_hard_delete before delete on public.captcha_passes
  for each row execute function public.forbid_hard_delete();

create or replace function public.register_club(
  p_name text, p_slug text, p_description text default null, p_address text default null,
  p_city text default null, p_contact_email text default null, p_contact_phone text default null)
returns public.tenants
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.tenants;
  pass_id text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  p_slug := lower(btrim(p_slug));

  -- idempotent retry: same owner, same slug
  select tn.* into t from public.tenants tn
  join public.tenant_members m on m.tenant_id = tn.id and m.user_id = uid and m.role = 'owner'
  where tn.slug = p_slug and tn.deleted_at is null and m.deleted_at is null;
  if found then return t; end if;

  -- consume one unexpired CAPTCHA pass
  select cp.id into pass_id from public.captcha_passes cp
   where cp.user_id = uid and cp.purpose = 'register_club' and cp.used_at is null
     and cp.expires_at > now() and cp.deleted_at is null
   order by cp.created_at limit 1 for update skip locked;
  if pass_id is null then raise exception 'captcha_required' using errcode = '42501'; end if;

  begin
    insert into public.tenants (slug, name, description, address, city, contact_email, contact_phone)
    values (p_slug, btrim(p_name), p_description, p_address, p_city, p_contact_email, p_contact_phone)
    returning * into t;
  exception
    when unique_violation then raise exception 'slug_taken' using errcode = '23505';
    when check_violation then raise exception 'invalid_slug_or_name' using errcode = '23514';
  end;

  update public.captcha_passes set used_at = now() where id = pass_id;
  insert into public.tenant_settings (tenant_id) values (t.id);
  insert into public.tenant_members (tenant_id, user_id, role) values (t.id, uid, 'owner');
  perform public._audit(t.id, 'tenant', t.id, 'register', null, to_jsonb(t));
  return t;
end;
$$;

-- Platform console: pending/approved clubs with the owner's name. Platform admin only.
create or replace function public.platform_list_clubs(p_status text default null)
returns table (id text, slug text, name text, city text, status text, contact_email text,
               owner_name text, created_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select t.id, t.slug, t.name, t.city, t.status, t.contact_email,
           (select pr.full_name from public.tenant_members m
              join public.profiles pr on pr.auth_user_id = m.user_id
             where m.tenant_id = t.id and m.role = 'owner' and m.deleted_at is null limit 1),
           t.created_at
    from public.tenants t
    where t.deleted_at is null and (p_status is null or t.status = p_status)
    order by t.created_at desc;
end;
$$;

revoke all on function public.register_club(text,text,text,text,text,text,text),
  public.platform_list_clubs(text) from public, anon, authenticated;
grant execute on function public.register_club(text,text,text,text,text,text,text),
  public.platform_list_clubs(text) to authenticated;
