-- DINKSLOT Stage 2 / 4: storage buckets and policies. Mirrors table isolation:
-- every object lives under <tenant_id>/..., the first path segment is checked
-- against the caller's club membership.
--   club-media (public read): <tenant_id>/cover.* , <tenant_id>/logo.*
--   payment (private):        <tenant_id>/qr/*  and  <tenant_id>/proofs/<auth uid>/*

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('club-media', 'club-media', true,  5242880, array['image/jpeg','image/png','image/webp']),
  ('payment',    'payment',    false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- club-media: public URL read (bucket is public); only that club's admins write.
create policy club_media_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'club-media' and public.is_tenant_member((storage.foldername(name))[1]));
create policy club_media_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'club-media' and public.is_tenant_member((storage.foldername(name))[1]));
create policy club_media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'club-media' and public.is_tenant_member((storage.foldername(name))[1]))
  with check (bucket_id = 'club-media' and public.is_tenant_member((storage.foldername(name))[1]));
create policy club_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'club-media' and public.is_tenant_member((storage.foldername(name))[1]));

-- payment: club admins read everything of their club.
create policy payment_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'payment' and public.is_tenant_member((storage.foldername(name))[1]));

-- payment: club admins manage QR images only (not proofs).
create policy payment_admin_qr_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment' and (storage.foldername(name))[2] = 'qr'
              and public.is_tenant_member((storage.foldername(name))[1]));
create policy payment_admin_qr_update on storage.objects for update to authenticated
  using (bucket_id = 'payment' and (storage.foldername(name))[2] = 'qr'
         and public.is_tenant_member((storage.foldername(name))[1]))
  with check (bucket_id = 'payment' and (storage.foldername(name))[2] = 'qr'
              and public.is_tenant_member((storage.foldername(name))[1]));
create policy payment_admin_qr_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment' and (storage.foldername(name))[2] = 'qr'
         and public.is_tenant_member((storage.foldername(name))[1]));

-- payment: a joined player may read the club's QR (signed URL while booking).
create policy payment_player_qr_select on storage.objects for select to authenticated
  using (bucket_id = 'payment' and (storage.foldername(name))[2] = 'qr'
         and public.is_club_player((storage.foldername(name))[1]));

-- payment: a joined player uploads and reads only their own proofs.
create policy payment_player_proof_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment' and (storage.foldername(name))[2] = 'proofs'
              and (storage.foldername(name))[3] = auth.uid()::text
              and public.is_club_player((storage.foldername(name))[1]));
create policy payment_player_proof_select on storage.objects for select to authenticated
  using (bucket_id = 'payment' and (storage.foldername(name))[2] = 'proofs'
         and (storage.foldername(name))[3] = auth.uid()::text);
