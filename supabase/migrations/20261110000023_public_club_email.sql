-- Expose the venue contact address alongside its public phone and location.
-- Preserve existing view column order for dependent queries.
create or replace view public.public_clubs with (security_barrier = true) as
  select t.id, t.slug, t.name, t.description, t.address, t.city, t.contact_phone,
         t.cover_path, t.logo_path, t.latitude, t.longitude, t.timezone,
         t.street, t.barangay, t.province, t.zip_code, t.contact_email
  from public.tenants t
  where t.status = 'approved' and t.deleted_at is null;
grant select on public.public_clubs to anon, authenticated;
