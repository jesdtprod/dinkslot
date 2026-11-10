-- DINKSLOT tenant isolation test (Stage 2).
-- Run:  powershell supabase/tests/run-isolation.ps1   (substitutes __PAGE__ and pages the report)
-- Everything runs inside ONE DO block and ends by raising an exception that carries the
-- report, so all test data (users, clubs, bookings, storage rows) is rolled back.
-- Each check runs as the given user (set local role + JWT claims), exactly like PostgREST.

do $test$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); sf uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  t1 text; t2 text; t3 text;
  c1 text; c1m text; c2 text; c3 text;
  b1 text; b1p2 text; b2 text;
  d2 timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila') + interval '2 days') at time zone 'Asia/Manila';
  rep text := ''; failrep text := ''; line text; fails int := 0; passes int := 0;
  t record; sql text; who uuid; v text; ok boolean; detail text; st text;
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data) values
    (a1,'authenticated','authenticated','admin1@test.local',now(),'{"full_name":"Admin One"}'),
    (a2,'authenticated','authenticated','admin2@test.local',now(),'{"full_name":"Admin Two"}'),
    (p1,'authenticated','authenticated','player1@test.local',now(),'{"full_name":"Player One"}'),
    (p2,'authenticated','authenticated','player2@test.local',now(),'{"full_name":"Player Two"}'),
    (pa,'authenticated','authenticated','platform@test.local',now(),'{"full_name":"Platform"}'),
    (a3,'authenticated','authenticated','admin3@test.local',now(),'{"full_name":"Admin Three"}'),
    (sf,'authenticated','authenticated','staff1@test.local',now(),'{"full_name":"Staff One","account_type":"tenant"}'),
    (p3,'authenticated','authenticated','player3@test.local',now(),'{"account_type":"player"}');
  update public.profiles set is_platform_admin = true where auth_user_id = pa;

  -- CAPTCHA passes (normally written by the verify-turnstile Edge Function)
  insert into public.captcha_passes (user_id, purpose) values
    (a1, 'register_club'), (a1, 'register_club'), (a2, 'register_club'), (a3, 'register_club');

  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into t1 from public.register_club('Club One', 'club-one', 'First club', 'Addr 1', 'Manila', 'one@test.local');
  insert into public.courts (tenant_id, name, hourly_rate) values (t1, 'Court 1', 300) returning id into c1;
  insert into public.courts (tenant_id, name, hourly_rate, status) values (t1, 'Court Maint', 300, 'maintenance') returning id into c1m;
  insert into public.court_blocks (tenant_id, court_id, starts_at, ends_at, reason)
    values (t1, c1, d2 + interval '3 days 10 hours', d2 + interval '3 days 12 hours', 'maintenance');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into t3 from public.register_club('Club Three', 'club-three');   -- stays pending
  insert into public.courts (tenant_id, name, hourly_rate) values (t3, 'Court Pending Club', 300) returning id into c3;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into t2 from public.register_club('Club Two', 'club-two', 'Second club');
  insert into public.courts (tenant_id, name, hourly_rate) values (t2, 'Court A', 400) returning id into c2;
  insert into public.court_blocks (tenant_id, court_id, starts_at, ends_at, reason)
    values (t2, c2, d2 + interval '3 days 10 hours', d2 + interval '3 days 12 hours', 'private event');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.decide_club(t1, 'approved');
  perform public.decide_club(t2, 'approved');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_club('club-one', 'P1');
  select id into b1 from public.create_booking(c1, d2 + interval '10 hours', d2 + interval '11 hours', 'k-p1-1');
  perform public.attach_payment_proof(b1, t1 || '/proofs/' || p1 || '/p1.png', 'GCASH-P1-0001', 'pk-p1-1');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.join_club('club-one', 'P2');
  perform public.join_club('club-two', 'P2');
  select id into b1p2 from public.create_booking(c1, d2 + interval '12 hours', d2 + interval '13 hours', 'k-p2-1');
  perform public.attach_payment_proof(b1p2, t1 || '/proofs/' || p2 || '/p2.png', 'GCASH-P2-0001', 'pk-p2-1');
  select id into b2 from public.create_booking(c2, d2 + interval '10 hours', d2 + interval '11 hours', 'k-p2-2');
  perform public.attach_payment_proof(b2, t2 || '/proofs/' || p2 || '/p2.png', 'GCASH-P2-0002', 'pk-p2-2');
  reset role;

  -- seed storage rows and an email_log row per club (as postgres)
  insert into storage.objects (bucket_id, name) values
    ('payment', t1 || '/qr/qr.png'), ('payment', t2 || '/qr/qr.png'),
    ('payment', t1 || '/proofs/' || p1 || '/p1.png'), ('payment', t1 || '/proofs/' || p2 || '/p2.png'),
    ('payment', t2 || '/proofs/' || p2 || '/p2.png');
  insert into public.email_log (tenant_id, booking_id, template, to_address) values
    (t1, b1, 'received', 'x@test.local'), (t2, b2, 'received', 'y@test.local');

  -- ------------------------------------------------------------------ checks
  -- expect: zero = count must be 0 (permission denied also counts as blocked)
  --         pos  = count must be > 0 (sanity: the user CAN see own data)
  --         deny = statement must raise an error
  --         eq:X = scalar must equal X
  for t in
    select * from (values
      -- Admin 1 vs club 2: select
      ('A1 select tenants of club 2',            'a1', $q$select count(*) from public.tenants where id='{T2}'$q$, 'zero'),
      ('A1 select tenant_settings of club 2',    'a1', $q$select count(*) from public.tenant_settings where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select tenant_members of club 2',     'a1', $q$select count(*) from public.tenant_members where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select club_players of club 2',        'a1', $q$select count(*) from public.club_players where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select courts of club 2',              'a1', $q$select count(*) from public.courts where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select court_blocks of club 2',        'a1', $q$select count(*) from public.court_blocks where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select bookings of club 2',            'a1', $q$select count(*) from public.bookings where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select booking_payments of club 2',    'a1', $q$select count(*) from public.booking_payments where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select notifications of club 2',       'a1', $q$select count(*) from public.notifications where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select email_log of club 2',           'a1', $q$select count(*) from public.email_log where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select audit_log of club 2',           'a1', $q$select count(*) from public.audit_log where tenant_id='{T2}'$q$, 'zero'),
      ('A1 select profiles of others',            'a1', $q$select count(*) from public.profiles where auth_user_id <> auth.uid()$q$, 'zero'),
      -- Admin 1 sanity: sees own club
      ('A1 sees own club row',                    'a1', $q$select count(*) from public.tenants where id='{T1}'$q$, 'pos'),
      ('A1 sees own club players',                'a1', $q$select count(*) from public.club_players where tenant_id='{T1}'$q$, 'pos'),
      ('A1 sees own club bookings',               'a1', $q$select count(*) from public.bookings where tenant_id='{T1}'$q$, 'pos'),
      ('A1 sees own club payment proofs',         'a1', $q$select count(*) from public.booking_payments where tenant_id='{T1}'$q$, 'pos'),
      ('A1 sees own audit_log',                   'a1', $q$select count(*) from public.audit_log where tenant_id='{T1}'$q$, 'pos'),
      -- Admin 1 vs club 2: update / delete / insert
      ('A1 update tenant of club 2',              'a1', $q$with u as (update public.tenants set name='hacked' where id='{T2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 update settings of club 2',            'a1', $q$with u as (update public.tenant_settings set payment_enabled=false where tenant_id='{T2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 update court of club 2',               'a1', $q$with u as (update public.courts set name='hacked' where tenant_id='{T2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 soft-delete court of club 2',          'a1', $q$with u as (update public.courts set deleted_at=now() where id='{C2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 update block of club 2',               'a1', $q$with u as (update public.court_blocks set reason='x' where tenant_id='{T2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 block player of club 2',               'a1', $q$with u as (update public.club_players set status='blocked' where tenant_id='{T2}' returning 1) select count(*) from u$q$, 'zero'),
      ('A1 update booking of club 2 (no grant)',  'a1', $q$update public.bookings set status='approved' where id='{B2}'$q$, 'deny'),
      ('A1 delete booking of club 2',             'a1', $q$delete from public.bookings where id='{B2}'$q$, 'deny'),
      ('A1 delete court of club 2',               'a1', $q$delete from public.courts where id='{C2}'$q$, 'deny'),
      ('A1 insert court into club 2',             'a1', $q$insert into public.courts (tenant_id,name,hourly_rate) values ('{T2}','x',1)$q$, 'deny'),
      ('A1 insert block into club 2',             'a1', $q$insert into public.court_blocks (tenant_id,court_id,starts_at,ends_at) values ('{T2}','{C2}',now(),now()+interval '1 hour')$q$, 'deny'),
      ('A1 insert member into club 2 (no grant)', 'a1', $q$insert into public.tenant_members (tenant_id,user_id,role) values ('{T2}','{A1}','owner')$q$, 'deny'),
      ('A1 insert booking directly (no grant)',   'a1', $q$insert into public.bookings (tenant_id,court_id,starts_at,ends_at,amount,reference_code) values ('{T1}','{C1}',now(),now()+interval '1 hour',1,'X')$q$, 'deny'),
      ('A1 cannot self-promote to platform admin','a1', $q$update public.profiles set is_platform_admin=true where auth_user_id=auth.uid()$q$, 'deny'),
      ('A1 cannot change own club status',        'a1', $q$update public.tenants set status='approved' where id='{T3}'$q$, 'deny'),
      ('A1 cannot move court to club 2',          'a1', $q$update public.courts set tenant_id='{T2}' where id='{C1}'$q$, 'deny'),
      ('A1 decide_booking on club 2 booking',     'a1', $q$select * from public.decide_booking('{B2}','approved')$q$, 'deny'),
      ('A1 decide_booking reject club 2 booking', 'a1', $q$select * from public.decide_booking('{B2}','rejected','nope')$q$, 'deny'),
      ('A1 cancel_booking on club 2 booking',     'a1', $q$select * from public.cancel_booking('{B2}','nope')$q$, 'deny'),
      ('A1 decide_club (not platform admin)',     'a1', $q$select * from public.decide_club('{T3}','approved')$q$, 'deny'),
      ('A1 create_booking in club 2 (not joined)','a1', $q$select * from public.create_booking('{C2}', now()+interval '2 days', now()+interval '2 days 1 hour', 'zz')$q$, 'deny'),
      -- Admin 1 vs club 2: storage
      ('A1 read club 2 QR via storage',           'a1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '{T2}/qr/%'$q$, 'zero'),
      ('A1 read club 2 proofs via storage',       'a1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '{T2}/proofs/%'$q$, 'zero'),
      ('A1 write club 2 QR via storage',          'a1', $q$insert into storage.objects (bucket_id,name,owner) values ('payment','{T2}/qr/evil.png','{A1}')$q$, 'deny'),
      ('A1 write club 2 media via storage',       'a1', $q$insert into storage.objects (bucket_id,name,owner) values ('club-media','{T2}/cover.png','{A1}')$q$, 'deny'),
      ('A1 reads own club QR via storage',        'a1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '{T1}/qr/%'$q$, 'pos'),
      ('A1 reads own club proofs via storage',    'a1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '{T1}/proofs/%'$q$, 'pos'),
      -- Admin 2 mirror (symmetry)
      ('A2 select bookings of club 1',            'a2', $q$select count(*) from public.bookings where tenant_id='{T1}'$q$, 'zero'),
      ('A2 select payments of club 1',            'a2', $q$select count(*) from public.booking_payments where tenant_id='{T1}'$q$, 'zero'),
      ('A2 decide_booking on club 1 booking',     'a2', $q$select * from public.decide_booking('{B1}','approved')$q$, 'deny'),
      ('A2 read club 1 proofs via storage',       'a2', $q$select count(*) from storage.objects where bucket_id='payment' and name like '{T1}/%'$q$, 'zero'),
      -- Player 1 vs player 2
      ('P1 sees own bookings',                    'p1', $q$select count(*) from public.bookings where id='{B1}'$q$, 'pos'),
      ('P1 select player 2 booking (same club)',  'p1', $q$select count(*) from public.bookings where id='{B1P2}'$q$, 'zero'),
      ('P1 select any booking but own',           'p1', $q$select count(*) from public.bookings where id <> '{B1}'$q$, 'zero'),
      ('P1 select player 2 proof',                'p1', $q$select count(*) from public.booking_payments where booking_id='{B1P2}'$q$, 'zero'),
      ('P1 sees own proof',                       'p1', $q$select count(*) from public.booking_payments where booking_id='{B1}'$q$, 'pos'),
      ('P1 select others notifications',          'p1', $q$select count(*) from public.notifications where user_id <> auth.uid()$q$, 'zero'),
      ('P1 sees own notifications',               'p1', $q$select count(*) from public.notifications where user_id = auth.uid()$q$, 'pos'),
      ('P1 select other club_players rows',       'p1', $q$select count(*) from public.club_players where user_id <> auth.uid()$q$, 'zero'),
      ('P1 select tenant_members',                'p1', $q$select count(*) from public.tenant_members$q$, 'zero'),
      ('P1 select tenant_settings (no direct)',   'p1', $q$select count(*) from public.tenant_settings$q$, 'zero'),
      ('P1 select courts table (no direct)',      'p1', $q$select count(*) from public.courts$q$, 'zero'),
      ('P1 select audit_log',                     'p1', $q$select count(*) from public.audit_log$q$, 'zero'),
      ('P1 select email_log',                     'p1', $q$select count(*) from public.email_log$q$, 'zero'),
      ('P1 read player 2 proof via storage',      'p1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '%/proofs/{P2}/%'$q$, 'zero'),
      ('P1 reads own proof via storage',          'p1', $q$select count(*) from storage.objects where bucket_id='payment' and name like '%/proofs/{P1}/%'$q$, 'pos'),
      ('P1 reads club QR via storage',            'p1', $q$select count(*) from storage.objects where bucket_id='payment' and name = '{T1}/qr/qr.png'$q$, 'pos'),
      ('P1 cannot read club 2 QR (not joined)',   'p1', $q$select count(*) from storage.objects where bucket_id='payment' and name = '{T2}/qr/qr.png'$q$, 'zero'),
      ('P1 upload proof as player 2',             'p1', $q$insert into storage.objects (bucket_id,name,owner) values ('payment','{T1}/proofs/{P2}/fake.png','{P1}')$q$, 'deny'),
      ('P1 upload proof to club 2 (not joined)',  'p1', $q$insert into storage.objects (bucket_id,name,owner) values ('payment','{T2}/proofs/{P1}/fake.png','{P1}')$q$, 'deny'),
      ('P1 cancel player 2 booking',              'p1', $q$select * from public.cancel_booking('{B1P2}')$q$, 'deny'),
      ('P1 decide own booking (not admin)',       'p1', $q$select * from public.decide_booking('{B1}','approved')$q$, 'deny'),
      ('P1 attach proof to player 2 booking',     'p1', $q$select * from public.attach_payment_proof('{B1P2}','{T1}/proofs/{P1}/x.png','REF-STOLEN','kx')$q$, 'deny'),
      ('P1 update booking directly (no grant)',   'p1', $q$update public.bookings set status='approved' where id='{B1}'$q$, 'deny'),
      ('P1 insert booking directly (no grant)',   'p1', $q$insert into public.bookings (tenant_id,court_id,starts_at,ends_at,amount,reference_code) values ('{T1}','{C1}',now(),now()+interval '1 hour',0,'X')$q$, 'deny'),
      ('P1 insert payment directly (no grant)',   'p1', $q$insert into public.booking_payments (tenant_id,booking_id,proof_path,payer_reference) values ('{T1}','{B1}','x','ABCDEF')$q$, 'deny'),
      ('P1 cannot change own player status',      'p1', $q$update public.club_players set status='blocked' where user_id=auth.uid()$q$, 'deny'),
      ('P1 read availability w/o names (3 cols)', 'p1', $q$select count(*) from (select * from public.court_availability('{C1}', now(), now()+interval '10 days')) s$q$, 'pos'),
      -- double booking + idempotency
      ('P2 double booking same slot is rejected', 'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '10 hours','{D2}'::timestamptz+interval '11 hours','k-dup')$q$, 'deny'),
      ('P2 overlapping slot is rejected',         'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '9 hours','{D2}'::timestamptz+interval '11 hours','k-dup2')$q$, 'deny'),
      ('Direct SQL double booking hits constraint','pg', $q$insert into public.bookings (tenant_id,court_id,starts_at,ends_at,amount,reference_code,status) values ('{T1}','{C1}','{D2}'::timestamptz+interval '10 hours','{D2}'::timestamptz+interval '11 hours',1,'DUP','pending')$q$, 'deny'),
      ('P2 booking during block is rejected',     'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '3 days 10 hours','{D2}'::timestamptz+interval '3 days 11 hours','k-blk')$q$, 'deny'),
      ('P2 off-grid time is rejected',            'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '14 hours 15 minutes','{D2}'::timestamptz+interval '15 hours 15 minutes','k-grid')$q$, 'deny'),
      ('P2 outside opening hours is rejected',    'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '3 hours','{D2}'::timestamptz+interval '4 hours','k-hours')$q$, 'deny'),
      ('P2 too long is rejected',                 'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '18 hours','k-long')$q$, 'deny'),
      ('P2 maintenance court is rejected',        'p2', $q$select * from public.create_booking('{C1M}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','k-maint')$q$, 'deny'),
      ('P2 pending-club court is rejected',       'p2', $q$select * from public.create_booking('{C3}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','k-pend')$q$, 'deny'),
      ('P2 same payer reference twice in a club', 'p2', $q$select * from public.attach_payment_proof('{B1P2}','{T1}/proofs/{P2}/p2b.png','gcash-p1-0001','pk-dupref')$q$, 'deny'),
      ('Retried idempotency key returns same id', 'p1', $q$select id from public.create_booking('{C1}','{D2}'::timestamptz+interval '10 hours','{D2}'::timestamptz+interval '11 hours','k-p1-1')$q$, 'eq:{B1}'),
      ('Retried proof key returns same payment',  'p1', $q$select count(*) from public.attach_payment_proof('{B1}','{T1}/proofs/{P1}/p1.png','GCASH-P1-0001','pk-p1-1')$q$, 'pos'),
      -- anonymous visitor
      ('ANON select tenants',                     'anon', $q$select count(*) from public.tenants$q$, 'zero'),
      ('ANON select courts',                      'anon', $q$select count(*) from public.courts$q$, 'zero'),
      ('ANON select bookings',                    'anon', $q$select count(*) from public.bookings$q$, 'zero'),
      ('ANON select profiles',                    'anon', $q$select count(*) from public.profiles$q$, 'zero'),
      ('ANON select notifications',               'anon', $q$select count(*) from public.notifications$q$, 'zero'),
      ('ANON sees exactly the 2 approved clubs',  'anon', $q$select count(*) from public.public_clubs where slug like 'club-%'$q$, 'eq:2'),
      ('ANON never sees pending club',            'anon', $q$select count(*) from public.public_clubs where slug='club-three'$q$, 'zero'),
      ('ANON sees only active courts of approved clubs', 'anon', $q$select count(*) from public.public_courts where club_slug like 'club-%'$q$, 'eq:2'),
      ('ANON cannot see maintenance court',       'anon', $q$select count(*) from public.public_courts where id='{C1M}'$q$, 'zero'),
      ('ANON cannot see pending club court',      'anon', $q$select count(*) from public.public_courts where id='{C3}'$q$, 'zero'),
      ('ANON availability returns rows',          'anon', $q$select count(*) from public.court_availability('{C1}', now(), now()+interval '10 days')$q$, 'pos'),
      ('ANON availability on pending club court', 'anon', $q$select count(*) from public.court_availability('{C3}', now(), now()+interval '10 days')$q$, 'zero'),
      ('ANON create_booking',                     'anon', $q$select * from public.create_booking('{C1}', now(), now(), 'a')$q$, 'deny'),
      ('ANON decide_booking',                     'anon', $q$select * from public.decide_booking('{B1}','approved')$q$, 'deny'),
      ('ANON register_club',                      'anon', $q$select * from public.register_club('Evil','evil-club')$q$, 'deny'),
      ('ANON read proofs via storage',            'anon', $q$select count(*) from storage.objects where bucket_id='payment'$q$, 'zero'),
      -- CAPTCHA gate and platform console
      ('A1 register_club without CAPTCHA pass',   'a1', $q$select * from public.register_club('No Captcha','no-captcha')$q$, 'deny'),
      ('P1 read captcha_passes',                  'p1', $q$select count(*) from public.captcha_passes$q$, 'zero'),
      ('P1 forge a CAPTCHA pass',                 'p1', $q$insert into public.captcha_passes (user_id,purpose) values ('{P1}','register_club')$q$, 'deny'),
      ('A1 platform_list_clubs (not admin)',      'a1', $q$select count(*) from public.platform_list_clubs()$q$, 'deny'),
      ('ANON platform_list_clubs',                'anon', $q$select count(*) from public.platform_list_clubs()$q$, 'deny'),
      ('Platform admin lists all 3 clubs',        'pa', $q$select count(*) from public.platform_list_clubs() where slug like 'club-%'$q$, 'eq:3'),
      ('Platform admin only: pending filter',     'pa', $q$select count(*) from public.platform_list_clubs('pending') where slug like 'club-%'$q$, 'eq:1'),
      -- happy path last (mutates state)
      ('A1 approves own booking with proof',      'a1', $q$select status from public.decide_booking('{B1}','approved',null,'dk-1')$q$, 'eq:approved'),
      ('A1 retried decision returns same result', 'a1', $q$select status from public.decide_booking('{B1}','approved',null,'dk-1')$q$, 'eq:approved'),
      ('A1 reject needs a reason',                'a1', $q$select * from public.decide_booking('{B1P2}','rejected','')$q$, 'deny'),
      ('A1 rejects with a reason',                'a1', $q$select status from public.decide_booking('{B1P2}','rejected','Wrong amount')$q$, 'eq:rejected'),
      ('Rejected booking releases the slot',      'p2', $q$select status from public.create_booking('{C1}','{D2}'::timestamptz+interval '12 hours','{D2}'::timestamptz+interval '13 hours','k-p2-again')$q$, 'eq:pending'),
      -- Stage 4/5: club admin edits own club; staff rules; owner-only actions
      ('A1 edits own club profile',               'a1', $q$with u as (update public.tenants set description='Updated' where id='{T1}' returning 1) select count(*) from u$q$, 'pos'),
      ('A1 edits own settings',                   'a1', $q$with u as (update public.tenant_settings set booking_window_days=14 where tenant_id='{T1}' returning 1) select count(*) from u$q$, 'pos'),
      ('A1 edits own court',                      'a1', $q$with u as (update public.courts set hourly_rate=350 where id='{C1}' returning 1) select count(*) from u$q$, 'pos'),
      ('A1 adds a block to own court',            'a1', $q$with i as (insert into public.court_blocks (tenant_id,court_id,starts_at,ends_at,reason) values ('{T1}','{C1}',now()+interval '30 days',now()+interval '30 days 1 hour','x') returning 1) select count(*) from i$q$, 'pos'),
      ('A1 cannot set deleted_at directly',       'a1', $q$update public.courts set deleted_at=now() where id='{C1M}'$q$, 'deny'),
      ('A1 deletes own court via function',       'a1', $q$select 'ok' from (select public.delete_court('{C1M}')) s$q$, 'eq:ok'),
      ('A1 delete_court of club 2',               'a1', $q$select public.delete_court('{C2}')$q$, 'deny'),
      ('A1 delete_court with upcoming bookings',  'a1', $q$select public.delete_court('{C1}')$q$, 'deny'),
      ('A1 delete_court_block of club 2',         'a1', $q$select public.delete_court_block((select id from public.court_blocks where tenant_id='{T2}' limit 1))$q$, 'deny'),
      ('A1 uploads own club media',               'a1', $q$with i as (insert into storage.objects (bucket_id,name,owner) values ('club-media','{T1}/cover.png','{A1}') returning 1) select count(*) from i$q$, 'pos'),
      ('A1 uploads own QR',                       'a1', $q$with i as (insert into storage.objects (bucket_id,name,owner) values ('payment','{T1}/qr/club.png','{A1}') returning 1) select count(*) from i$q$, 'pos'),
      ('A1 add_staff to club 2',                  'a1', $q$select * from public.add_staff('{T2}','player1@test.local')$q$, 'deny'),
      ('P1 add_staff (not owner)',                'p1', $q$select * from public.add_staff('{T1}','player2@test.local')$q$, 'deny'),
      ('A1 add_staff unknown email',              'a1', $q$select * from public.add_staff('{T1}','nobody@nowhere.test')$q$, 'deny'),
      ('A1 adds staff account to club 1',           'a1', $q$select role from public.add_staff('{T1}','staff1@test.local')$q$, 'eq:staff'),
      ('A1 add_staff twice is idempotent',        'a1', $q$select role from public.add_staff('{T1}','staff1@test.local')$q$, 'eq:staff'),
      ('Staff SF now sees club 1 courts',         'sf', $q$select count(*) from public.courts where tenant_id='{T1}'$q$, 'pos'),
      ('Staff SF still blind to club 2 courts',   'sf', $q$select count(*) from public.courts where tenant_id='{T2}'$q$, 'zero'),
      ('Staff SF cannot edit club settings',      'sf', $q$with u as (update public.tenant_settings set payment_enabled=false where tenant_id='{T1}' returning 1) select count(*) from u$q$, 'zero'),
      ('Staff SF cannot edit club profile',       'sf', $q$with u as (update public.tenants set name='x' where id='{T1}' returning 1) select count(*) from u$q$, 'zero'),
      ('Staff SF cannot add staff',               'sf', $q$select * from public.add_staff('{T1}','player2@test.local')$q$, 'deny'),
      ('Staff SF cannot list staff',              'sf', $q$select * from public.list_tenant_staff('{T1}')$q$, 'deny'),
      ('Staff SF edits a court (allowed)',        'sf', $q$with u as (update public.courts set surface='Hard' where id='{C1}' returning 1) select count(*) from u$q$, 'pos'),
      ('A1 lists staff (owner + staff = 2)',      'a1', $q$select count(*) from public.list_tenant_staff('{T1}')$q$, 'eq:2'),
      ('A2 list staff of club 1',                 'a2', $q$select count(*) from public.list_tenant_staff('{T1}')$q$, 'deny'),
      ('A1 cannot remove the owner',              'a1', $q$select public.remove_staff((select id from public.tenant_members where tenant_id='{T1}' and role='owner' and deleted_at is null))$q$, 'deny'),
      ('A2 cannot remove club 1 staff',           'a2', $q$select public.remove_staff((select id from public.tenant_members where tenant_id='{T1}' and role='staff' and deleted_at is null))$q$, 'deny'),
      ('A1 removes staff',                        'a1', $q$select 'ok' from (select public.remove_staff((select id from public.tenant_members where tenant_id='{T1}' and role='staff' and deleted_at is null))) s$q$, 'eq:ok'),
      ('Removed staff SF loses access',           'sf', $q$select count(*) from public.courts where tenant_id='{T1}'$q$, 'zero'),
      -- Stage 6: cancel, expire, cutoff
      ('Player cancels own approved booking',     'p1', $q$select status from public.cancel_booking('{B1}')$q$, 'eq:cancelled'),
      ('Cancel retried returns same result',      'p1', $q$select status from public.cancel_booking('{B1}')$q$, 'eq:cancelled'),
      ('Cancelled slot can be rebooked',          'p2', $q$select status from public.create_booking('{C1}','{D2}'::timestamptz+interval '10 hours','{D2}'::timestamptz+interval '11 hours','k-rebook')$q$, 'eq:pending'),
      ('Admin cancel needs a reason',             'a1', $q$select * from public.cancel_booking((select id from public.bookings where idempotency_key='k-rebook'), '')$q$, 'deny'),
      ('Admin cancels with a reason',             'a1', $q$select status from public.cancel_booking((select id from public.bookings where idempotency_key='k-rebook'), 'Court flooded')$q$, 'eq:cancelled'),
      ('Player sees admin cancel reason',         'p2', $q$select cancel_reason from public.bookings where idempotency_key='k-rebook'$q$, 'eq:Court flooded'),
      ('Setup: unpaid hold is past due',          'pg', $q$with u as (update public.bookings set expires_at = now() - interval '1 minute' where idempotency_key='k-p2-again' and status='pending' returning 1) select count(*) from u$q$, 'pos'),
      ('Client cannot run expire_pending_bookings','p2', $q$select public.expire_pending_bookings()$q$, 'deny'),
      ('expire_pending_bookings expires it',      'pg', $q$select public.expire_pending_bookings()::text$q$, 'pos'),
      ('Booking is now expired',                  'p2', $q$select status from public.bookings where idempotency_key='k-p2-again'$q$, 'eq:expired'),
      ('Player was notified of expiry',           'p2', $q$select count(*) from public.notifications where type='booking_expired' and user_id=auth.uid()$q$, 'pos'),
      ('Expired slot can be booked again',        'p1', $q$select status from public.create_booking('{C1}','{D2}'::timestamptz+interval '12 hours','{D2}'::timestamptz+interval '13 hours','k-after-expiry')$q$, 'eq:pending'),
      ('Setup: booking starting in 2 hours',      'pg', $q$with i as (insert into public.bookings (tenant_id,court_id,player_id,starts_at,ends_at,amount,reference_code,status) select '{T2}','{C2}',cp.id,now()+interval '2 hours',now()+interval '3 hours',400,'SOON-1','approved' from public.club_players cp where cp.tenant_id='{T2}' and cp.user_id='{P2}' returning 1) select count(*) from i$q$, 'pos'),
      ('Player cannot cancel inside the cutoff',  'p2', $q$select * from public.cancel_booking((select id from public.bookings where reference_code='SOON-1'))$q$, 'deny'),
      ('Club admin can cancel inside the cutoff', 'a2', $q$select status from public.cancel_booking((select id from public.bookings where reference_code='SOON-1'), 'Closed early')$q$, 'eq:cancelled'),
      -- Stage 7: notifications
      ('Platform admin notified of new clubs',    'pa', $q$select count(*) from public.notifications where type='club_registered' and user_id=auth.uid()$q$, 'pos'),
      ('Club admin A1 not told about club 2 registration', 'a1', $q$select count(*) from public.notifications where type='club_registered'$q$, 'zero'),
      ('Club owner notified when club approved',  'a1', $q$select count(*) from public.notifications where type='club_approved' and user_id=auth.uid()$q$, 'pos'),
      ('A1 admin gets booking_requested for own club only', 'a1', $q$select count(*) from public.notifications where type='booking_requested' and tenant_id='{T2}'$q$, 'zero'),
      ('Player reads own notifications and marks read', 'p2', $q$with u as (update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null returning 1) select count(*) from u$q$, 'pos'),
      ('Player cannot mark another user notification read', 'p1', $q$with u as (update public.notifications set read_at=now() where user_id <> auth.uid() returning 1) select count(*) from u$q$, 'zero'),
      ('Player cannot edit notification text',    'p2', $q$update public.notifications set message='hacked' where user_id=auth.uid()$q$, 'deny'),
      ('Player cannot forge a notification',      'p2', $q$insert into public.notifications (user_id,type) values (auth.uid(),'booking_approved')$q$, 'deny'),
      -- one account, one club
      ('Owner cannot register a second club',     'a1', $q$select * from public.register_club('Second Club','second-club')$q$, 'deny'),
      ('Second club attempt does not use up the CAPTCHA pass', 'pg', $q$select count(*) from public.captcha_passes where user_id='{A1}' and used_at is null$q$, 'pos'),
      ('Owner of club 2 cannot add a club 1 owner as staff', 'a2', $q$select * from public.add_staff('{T2}','admin1@test.local')$q$, 'deny'),
      ('Duplicate membership row blocked by the database', 'pg', $q$insert into public.tenant_members (tenant_id,user_id,role) values ('{T2}','{A1}','staff')$q$, 'deny'),
      ('Setup: give SF a CAPTCHA pass',           'pg', $q$with i as (insert into public.captcha_passes (user_id,purpose) values ('{SF}','register_club') returning 1) select count(*) from i$q$, 'pos'),
      ('A1 re-adds staff account',                  'a1', $q$select role from public.add_staff('{T1}','staff1@test.local')$q$, 'eq:staff'),
      ('Staff SF cannot register a club even with a pass', 'sf', $q$select * from public.register_club('Staff Club','staff-club')$q$, 'deny'),
      ('Club three owner cannot see club one data', 'a3', $q$select count(*) from public.bookings where tenant_id='{T1}'$q$, 'zero'),
      -- Stage 8: rate limits
      ('rate limit: 1st call allowed',            'pg', $q$select 'ok' from (select public._rate_limit('t:test', 2, 3600)) s$q$, 'eq:ok'),
      ('rate limit: 2nd call allowed',            'pg', $q$select 'ok' from (select public._rate_limit('t:test', 2, 3600)) s$q$, 'eq:ok'),
      ('rate limit: 3rd call is refused',         'pg', $q$select public._rate_limit('t:test', 2, 3600)$q$, 'deny'),
      ('Clients cannot call the limiter',         'p1', $q$select public._rate_limit('t:x', 1, 60)$q$, 'deny'),
      ('Clients cannot read or reset counters',   'p1', $q$select count(*) from public.rate_limits$q$, 'zero'),
      ('Clients cannot delete counters',          'p1', $q$delete from public.rate_limits$q$, 'deny'),
      -- Separate registrations: players and clubs
      ('Account types come from sign-up metadata',   'p3', $q$select account_type from public.profiles where auth_user_id=auth.uid()$q$, 'eq:player'),
      ('Club signup account is a tenant',            'sf', $q$select account_type from public.profiles where auth_user_id=auth.uid()$q$, 'eq:tenant'),
      ('Registering a club makes a tenant account',  'a1', $q$select account_type from public.profiles where auth_user_id=auth.uid()$q$, 'eq:tenant'),
      ('Joining a club makes a player account',      'p1', $q$select account_type from public.profiles where auth_user_id=auth.uid()$q$, 'eq:player'),
      ('Player account cannot register a club',      'p1', $q$select * from public.register_club('Player Club','player-club')$q$, 'deny'),
      ('Club owner cannot join a club as a player',  'a1', $q$select * from public.join_club('club-two','Owner')$q$, 'deny'),
      ('Club staff cannot join a club as a player',  'sf', $q$select * from public.join_club('club-two','Staff')$q$, 'deny'),
      ('Player cannot be added as club staff',       'a1', $q$select * from public.add_staff('{T1}','player2@test.local')$q$, 'deny'),
      ('Player cannot switch to a club account',     'p1', $q$select public.choose_account_type('tenant')$q$, 'deny'),
      ('Player can confirm their own type',          'p1', $q$select public.choose_account_type('player')$q$, 'eq:player'),
      ('Club owner cannot switch to a player',       'a1', $q$select public.choose_account_type('player')$q$, 'deny'),
      ('Clients cannot edit account_type directly',  'p1', $q$update public.profiles set account_type='tenant' where auth_user_id=auth.uid()$q$, 'deny'),
      -- Bookings made by the club (walk-in guests and registered players)
      ('Club books a walk-in guest',                 'a1', $q$select status from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','ab-1',null,'Walk-in Juan','0917')$q$, 'eq:approved'),
      ('Guest booking is marked walk_in',            'a1', $q$select source from public.bookings where idempotency_key='ab-1'$q$, 'eq:walk_in'),
      ('Club booking retry returns the same booking','a1', $q$select ((select id from public.bookings where idempotency_key='ab-1') = (select id from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','ab-1',null,'Walk-in Juan','0917')))::text$q$, 'eq:true'),
      ('Players cannot see the guest booking',       'p1', $q$select count(*) from public.bookings where guest_name='Walk-in Juan'$q$, 'zero'),
      ('Guest booking holds the slot for players',   'p2', $q$select * from public.create_booking('{C1}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','k-guestslot')$q$, 'deny'),
      ('Club books for a registered player',         'a1', $q$select status from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '15 hours','{D2}'::timestamptz+interval '16 hours','ab-2',(select id from public.club_players where tenant_id='{T1}' and user_id='{P2}'))$q$, 'eq:approved'),
      ('That player sees the booking made for them', 'p2', $q$select count(*) from public.bookings where idempotency_key='ab-2'$q$, 'pos'),
      ('That player is notified',                    'p2', $q$select count(*) from public.notifications n join public.bookings b on b.id=n.booking_id where b.idempotency_key='ab-2' and n.user_id=auth.uid()$q$, 'pos'),
      ('Cannot give both a player and a guest',      'a1', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '16 hours','{D2}'::timestamptz+interval '17 hours','ab-3',(select id from public.club_players where tenant_id='{T1}' and user_id='{P2}'),'Guest')$q$, 'deny'),
      ('Cannot give neither a player nor a guest',   'a1', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '16 hours','{D2}'::timestamptz+interval '17 hours','ab-4')$q$, 'deny'),
      ('Club cannot book outside opening hours',     'a1', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '3 hours','{D2}'::timestamptz+interval '4 hours','ab-5',null,'Guest')$q$, 'deny'),
      ('Club booking must sit on the slot grid',     'a1', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '17 hours 30 minutes','{D2}'::timestamptz+interval '18 hours 30 minutes','ab-6',null,'Guest')$q$, 'deny'),
      ('Club cannot double-book its own court',      'a1', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','ab-7',null,'Another Guest')$q$, 'deny'),
      ('Club 1 cannot book a club 2 court',          'a1', $q$select * from public.create_admin_booking('{C2}','{D2}'::timestamptz+interval '14 hours','{D2}'::timestamptz+interval '15 hours','ab-8',null,'Guest')$q$, 'deny'),
      ('Players cannot use club booking',            'p2', $q$select * from public.create_admin_booking('{C1}','{D2}'::timestamptz+interval '18 hours','{D2}'::timestamptz+interval '19 hours','ab-9',null,'Guest')$q$, 'deny'),
      ('Anonymous cannot use club booking',          'anon', $q$select * from public.create_admin_booking('{C1}', now(), now(), 'x', null, 'g')$q$, 'deny'),
      ('Club can cancel its guest booking',          'a1', $q$select status from public.cancel_booking((select id from public.bookings where idempotency_key='ab-1'), 'Guest did not show')$q$, 'eq:cancelled'),
      ('Club adds a registered player by email',     'a1', $q$select display_name from public.admin_add_player('{T1}','player3@test.local')$q$, 'eq:player3'),
      ('Adding the same player again is harmless',   'a1', $q$select display_name from public.admin_add_player('{T1}','player3@test.local')$q$, 'eq:player3'),
      ('Added player is notified',                   'p3', $q$select count(*) from public.notifications where type='added_to_club' and user_id=auth.uid()$q$, 'pos'),
      ('Club cannot add a club account as a player','a1', $q$select * from public.admin_add_player('{T1}','staff1@test.local')$q$, 'deny'),
      ('Unknown email cannot be added as a player',  'a1', $q$select * from public.admin_add_player('{T1}','nobody@nowhere.test')$q$, 'deny'),
      ('Club 2 admin cannot add players to club 1',  'a2', $q$select * from public.admin_add_player('{T1}','player3@test.local')$q$, 'deny'),
      -- club address (Philippine)
      ('Owner saves manager and PH address on own club', 'a1', $q$with u as (update public.tenants set manager_name='Juan Dela Cruz', street='12 Purok Uno', barangay='Poblacion', province='Cebu', city='City of Cebu', zip_code='6000', psgc_province='0702200000', psgc_city='0730600000', psgc_barangay='0730600001' where id='{T1}' returning 1) select count(*) from u$q$, 'pos'),
      ('ZIP must be 4 digits',                       'a1', $q$update public.tenants set zip_code='60A0' where id='{T1}'$q$, 'deny'),
      ('ZIP of 5 digits is refused',                 'a1', $q$update public.tenants set zip_code='60000' where id='{T1}'$q$, 'deny'),
      ('Bad PSGC code is refused',                   'a1', $q$update public.tenants set psgc_city='x; drop' where id='{T1}'$q$, 'deny'),
      ('Club 2 owner cannot edit club 1 address',    'a2', $q$with u as (update public.tenants set street='hacked' where id='{T1}' returning 1) select count(*) from u$q$, 'zero'),
      ('Staff cannot edit the club address',         'sf', $q$with u as (update public.tenants set province='Hacked' where id='{T1}' returning 1) select count(*) from u$q$, 'zero'),
      ('Public view shows province and ZIP only when approved', 'anon', $q$select count(*) from public.public_clubs where slug='club-one' and province='Cebu' and zip_code='6000'$q$, 'eq:1'),
      ('Manager name is not in the public view',     'anon', $q$select manager_name from public.public_clubs$q$, 'deny'),
      ('Anonymous cannot read manager from tenants', 'anon', $q$select manager_name from public.tenants$q$, 'deny'),
      ('Platform admin sees the manager name',       'pa', $q$select manager_name from public.platform_list_clubs() where slug='club-one'$q$, 'eq:Juan Dela Cruz'),
      -- multiple payment QR codes
      ('Owner adds a payment QR',                    'a1', $q$with i as (insert into public.payment_qrs (tenant_id,label,account_name,account_number,qr_path) values ('{T1}','GCash','Juan D','0917 000 0000','{T1}/qr/gcash.png') returning 1) select count(*) from i$q$, 'pos'),
      ('Owner adds a second QR',                     'a1', $q$with i as (insert into public.payment_qrs (tenant_id,label,qr_path,sort_order) values ('{T1}','Maya','{T1}/qr/maya.png',1) returning 1) select count(*) from i$q$, 'pos'),
      ('Joined player sees both active QR codes',    'p2', $q$select jsonb_array_length(public.get_booking_info('{C1}')->'qrs')::text$q$, 'eq:2'),
      ('Owner switches one QR off',                  'a1', $q$with u as (update public.payment_qrs set is_active=false where tenant_id='{T1}' and label='Maya' returning 1) select count(*) from u$q$, 'pos'),
      ('Inactive QR is hidden from players',         'p2', $q$select jsonb_array_length(public.get_booking_info('{C1}')->'qrs')::text$q$, 'eq:1'),
      ('Only the active QR is returned',             'p2', $q$select public.get_booking_info('{C1}')->'qrs'->0->>'label'$q$, 'eq:GCash'),
      ('Players cannot read the QR table directly',  'p2', $q$select count(*) from public.payment_qrs$q$, 'zero'),
      ('Staff cannot add a payment QR',              'sf', $q$insert into public.payment_qrs (tenant_id,label,qr_path) values ('{T1}','X','{T1}/qr/x.png')$q$, 'deny'),
      ('Staff cannot switch a QR',                   'sf', $q$with u as (update public.payment_qrs set is_active=false where tenant_id='{T1}' returning 1) select count(*) from u$q$, 'zero'),
      ('Club 2 owner cannot add a QR to club 1',     'a2', $q$insert into public.payment_qrs (tenant_id,label,qr_path) values ('{T1}','X','{T1}/qr/x.png')$q$, 'deny'),
      ('Club 2 owner cannot see club 1 QR codes',    'a2', $q$select count(*) from public.payment_qrs where tenant_id='{T1}'$q$, 'zero'),
      ('QR path must stay in the club folder',       'a1', $q$insert into public.payment_qrs (tenant_id,label,qr_path) values ('{T1}','Bad','{T2}/qr/steal.png')$q$, 'deny'),
      ('QR path cannot climb out of the folder',     'a1', $q$insert into public.payment_qrs (tenant_id,label,qr_path) values ('{T1}','Bad','{T1}/qr/../proofs/x.png')$q$, 'deny'),
      ('QR needs a label',                           'a1', $q$insert into public.payment_qrs (tenant_id,label,qr_path) values ('{T1}','   ','{T1}/qr/y.png')$q$, 'deny'),
      ('Anonymous cannot call get_booking_info',     'anon', $q$select public.get_booking_info('{C1}')$q$, 'deny'),
      ('Non-member cannot see club 2 payment info',  'p3', $q$select public.get_booking_info('{C2}')$q$, 'deny'),
      ('Owner deletes a QR via the function',        'a1', $q$select 'ok' from (select public.delete_payment_qr((select id from public.payment_qrs where tenant_id='{T1}' and label='Maya'))) s$q$, 'eq:ok'),
      ('Club 2 owner cannot delete club 1 QR',       'a2', $q$select public.delete_payment_qr((select id from public.payment_qrs where tenant_id='{T1}' limit 1))$q$, 'deny'),
      ('Cannot set deleted_at directly',             'a1', $q$update public.payment_qrs set deleted_at=now() where tenant_id='{T1}'$q$, 'deny'),
      ('Payment off hides all QR codes',             'a1', $q$with u as (update public.tenant_settings set payment_enabled=false where tenant_id='{T1}' returning 1) select count(*) from u$q$, 'pos'),
      ('No QR codes are offered when payment is off','p2', $q$select jsonb_array_length(public.get_booking_info('{C1}')->'qrs')::text$q$, 'eq:0'),
      ('Creating many clubs in a day is limited (6th is refused)', 'pg', $q$do $d$ declare i int; begin
          perform set_config('request.jwt.claims', json_build_object('sub','{P2}','role','authenticated')::text, true);
          for i in 1..11 loop
            insert into public.tenants (slug, name, status) values ('rl-club-' || i, 'RL Club ' || i, 'approved');
          end loop; end $d$$q$, 'deny')
    ) as x(name, who, sql, expect)
  loop
    sql := t.sql;
    sql := replace(sql, '{T1}', t1); sql := replace(sql, '{T2}', t2); sql := replace(sql, '{T3}', t3);
    sql := replace(sql, '{C1M}', c1m); sql := replace(sql, '{C1}', c1); sql := replace(sql, '{C2}', c2); sql := replace(sql, '{C3}', c3);
    sql := replace(sql, '{B1P2}', b1p2); sql := replace(sql, '{B1}', b1); sql := replace(sql, '{B2}', b2);
    sql := replace(sql, '{SF}', sf::text); sql := replace(sql, '{A1}', a1::text); sql := replace(sql, '{P1}', p1::text); sql := replace(sql, '{P2}', p2::text);
    sql := replace(sql, '{D2}', d2::text);

    who := case t.who when 'a1' then a1 when 'a2' then a2 when 'p1' then p1 when 'p2' then p2 when 'pa' then pa when 'a3' then a3 when 'sf' then sf when 'p3' then p3 else null end;
    v := null; st := null; detail := null;
    begin
      if t.who = 'anon' then
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        set local role anon;
      elsif t.who <> 'pg' then
        perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      execute sql into v;
      reset role;
    exception when others then
      reset role;
      st := sqlstate; detail := sqlerrm;
    end;

    if t.expect = 'zero' then
      ok := (st is null and v = '0') or st = '42501';
    elsif t.expect = 'pos' then
      ok := st is null and v ~ '^[0-9]+$' and v::int > 0;
    elsif t.expect = 'deny' then
      ok := st is not null;
    elsif t.expect = 'ok' then
      ok := st is not null;           -- guarded update must raise
    else
      ok := st is null and v = replace(replace(replace(substr(t.expect, 4), '{B1}', b1), '{B1P2}', b1p2), '{B2}', b2);
    end if;

    if ok then passes := passes + 1; else fails := fails + 1; end if;
    line := (case when ok then 'PASS ' else 'FAIL ' end) || t.name
           || ' -> ' || coalesce(case when st is not null then 'blocked[' || st || '] ' || left(detail, 60)
                                       else 'result=' || coalesce(v, 'null') end, '') || E'\n';
    rep := rep || line;
    if not ok then failrep := failrep || line; end if;
  end loop;

  -- The CLI truncates error text, so the report is paged: __PAGE__ = 0 gives the summary
  -- and failures; 1..n give 900-character slices of the full report.
  if __PAGE__ = 0 then
    raise exception E'\nPASSED: %  FAILED: %  (all test data rolled back)\n%', passes, fails, failrep;
  else
    raise exception E'%', substr(rep, (__PAGE__ - 1) * 900 + 1, 900);
  end if;
end
$test$;
