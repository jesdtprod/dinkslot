-- Philippine address for clubs: manager name, street/purok/sitio, barangay, city/municipality,
-- province and ZIP code. The screens fill the province/city/barangay from the PSGC address API and
-- keep the PSGC codes next to the names. The database checks formats only (it cannot call the API).
--   city        = city or municipality (column already existed)
--   address     = "Street, Brgy. X" composed by the screen, kept for older code and public display
--   manager_name stays private (not in the public view); the platform admin sees it in the console.

alter table public.tenants
  add column manager_name   text check (manager_name is null or char_length(manager_name) between 2 and 80),
  add column street         text check (street is null or char_length(street) <= 120),
  add column barangay       text check (barangay is null or char_length(barangay) <= 80),
  add column province       text check (province is null or char_length(province) <= 80),
  add column zip_code       text check (zip_code is null or zip_code ~ '^[0-9]{4}$'),
  add column psgc_province  text check (psgc_province is null or psgc_province ~ '^[A-Za-z0-9]{3,10}$'),
  add column psgc_city      text check (psgc_city is null or psgc_city ~ '^[0-9]{9,10}$'),
  add column psgc_barangay  text check (psgc_barangay is null or psgc_barangay ~ '^[0-9]{9,10}$');

-- the club owner edits these on their own club (same rule as the other profile columns)
grant update (manager_name, street, barangay, province, zip_code, psgc_province, psgc_city, psgc_barangay)
  on public.tenants to authenticated;

-- public club view: address parts are shown to everyone; manager_name and PSGC codes are not
create or replace view public.public_clubs with (security_barrier = true) as
  select t.id, t.slug, t.name, t.description, t.address, t.city, t.contact_phone,
         t.cover_path, t.logo_path, t.latitude, t.longitude, t.timezone,
         t.street, t.barangay, t.province, t.zip_code
  from public.tenants t
  where t.status = 'approved' and t.deleted_at is null;
grant select on public.public_clubs to anon, authenticated;

-- platform console: show the manager and the place
drop function if exists public.platform_list_clubs(text);
create function public.platform_list_clubs(p_status text default null)
returns table (id text, slug text, name text, city text, status text, contact_email text,
               owner_name text, created_at timestamptz, manager_name text, province text)
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
           t.created_at, t.manager_name, t.province
    from public.tenants t
    where t.deleted_at is null and (p_status is null or t.status = p_status)
    order by t.created_at desc;
end;
$$;
revoke all on function public.platform_list_clubs(text) from public, anon, authenticated;
grant execute on function public.platform_list_clubs(text) to authenticated;
