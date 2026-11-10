-- Member (player) profile: photo, birth date, civil status and a Philippine address (same fields as the club profile).
-- The photo lives in the public "avatars" bucket under <auth uid>/..., so only the owner can write it.

alter table public.profiles
  add column birth_date     date check (birth_date is null or birth_date >= date '1900-01-01'),
  add column civil_status   text check (civil_status is null or civil_status in ('single','married','widowed','separated','divorced')),
  add column avatar_path    text check (avatar_path is null or char_length(avatar_path) <= 200),
  add column street         text check (street is null or char_length(street) <= 120),
  add column barangay       text check (barangay is null or char_length(barangay) <= 80),
  add column city           text check (city is null or char_length(city) <= 80),
  add column province       text check (province is null or char_length(province) <= 80),
  add column zip_code       text check (zip_code is null or zip_code ~ '^[0-9]{4}$'),
  add column address        text check (address is null or char_length(address) <= 250),
  add column psgc_province  text check (psgc_province is null or psgc_province ~ '^[A-Za-z0-9]{3,10}$'),
  add column psgc_city      text check (psgc_city is null or psgc_city ~ '^[0-9]{9,10}$'),
  add column psgc_barangay  text check (psgc_barangay is null or psgc_barangay ~ '^[0-9]{9,10}$');

grant update (birth_date, civil_status, avatar_path, street, barangay, city, province, zip_code, address,
              psgc_province, psgc_city, psgc_barangay) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
