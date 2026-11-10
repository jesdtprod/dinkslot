-- DINKSLOT tenant isolation test (Stage 2).
-- Run:  powershell supabase/tests/run-isolation.ps1   (substitutes __PAGE__ and pages the report)
-- Everything runs inside ONE DO block and ends by raising an exception that carries the
-- report, so all test data (users, clubs, bookings, storage rows) is rolled back.
-- Each check runs as the given user (set local role + JWT claims), exactly like PostgREST.

do $test$
declare
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  pa uuid := gen_random_uuid();
  t1 text; t2 text; t3 text;
  c1 text; c1m text; c2 text; c3 text;
  b1 text; b1p2 text; b2 text;
  d2 timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila') + interval '2 days') at time zone 'Asia/Manila';
  rep text := ''; failrep text := ''; line text; fails int := 0; passes int := 0;
  t record; sql text; who uuid; v text; ok boolean; detail text; st text;
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, aud, role, email, raw_user_meta_data) values
    (a1,'authenticated','authenticated','admin1@test.local','{"full_name":"Admin One"}'),
    (a2,'authenticated','authenticated','admin2@test.local','{"full_name":"Admin Two"}'),
    (p1,'authenticated','authenticated','player1@test.local','{"full_name":"Player One"}'),
    (p2,'authenticated','authenticated','player2@test.local','{"full_name":"Player Two"}'),
    (pa,'authenticated','authenticated','platform@test.local','{"full_name":"Platform"}');
  update public.profiles set is_platform_admin = true where auth_user_id = pa;

  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into t1 from public.register_club('Club One', 'club-one', 'First club', 'Addr 1', 'Manila', 'one@test.local');
  select id into t3 from public.register_club('Club Three', 'club-three');   -- stays pending
  insert into public.courts (tenant_id, name, hourly_rate) values (t1, 'Court 1', 300) returning id into c1;
  insert into public.courts (tenant_id, name, hourly_rate, status) values (t1, 'Court Maint', 300, 'maintenance') returning id into c1m;
  insert into public.courts (tenant_id, name, hourly_rate) values (t3, 'Court Pending Club', 300) returning id into c3;
  insert into public.court_blocks (tenant_id, court_id, starts_at, ends_at, reason)
    values (t1, c1, d2 + interval '3 days 10 hours', d2 + interval '3 days 12 hours', 'maintenance');
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
      ('ANON sees exactly the 2 approved clubs',  'anon', $q$select count(*) from public.public_clubs$q$, 'eq:2'),
      ('ANON never sees pending club',            'anon', $q$select count(*) from public.public_clubs where slug='club-three'$q$, 'zero'),
      ('ANON sees only active courts of approved clubs', 'anon', $q$select count(*) from public.public_courts$q$, 'eq:2'),
      ('ANON cannot see maintenance court',       'anon', $q$select count(*) from public.public_courts where id='{C1M}'$q$, 'zero'),
      ('ANON cannot see pending club court',      'anon', $q$select count(*) from public.public_courts where id='{C3}'$q$, 'zero'),
      ('ANON availability returns rows',          'anon', $q$select count(*) from public.court_availability('{C1}', now(), now()+interval '10 days')$q$, 'pos'),
      ('ANON availability on pending club court', 'anon', $q$select count(*) from public.court_availability('{C3}', now(), now()+interval '10 days')$q$, 'zero'),
      ('ANON create_booking',                     'anon', $q$select * from public.create_booking('{C1}', now(), now(), 'a')$q$, 'deny'),
      ('ANON decide_booking',                     'anon', $q$select * from public.decide_booking('{B1}','approved')$q$, 'deny'),
      ('ANON register_club',                      'anon', $q$select * from public.register_club('Evil','evil-club')$q$, 'deny'),
      ('ANON read proofs via storage',            'anon', $q$select count(*) from storage.objects where bucket_id='payment'$q$, 'zero'),
      -- happy path last (mutates state)
      ('A1 approves own booking with proof',      'a1', $q$select status from public.decide_booking('{B1}','approved',null,'dk-1')$q$, 'eq:approved'),
      ('A1 retried decision returns same result', 'a1', $q$select status from public.decide_booking('{B1}','approved',null,'dk-1')$q$, 'eq:approved'),
      ('A1 reject needs a reason',                'a1', $q$select * from public.decide_booking('{B1P2}','rejected','')$q$, 'deny'),
      ('A1 rejects with a reason',                'a1', $q$select status from public.decide_booking('{B1P2}','rejected','Wrong amount')$q$, 'eq:rejected'),
      ('Rejected booking releases the slot',      'p2', $q$select status from public.create_booking('{C1}','{D2}'::timestamptz+interval '12 hours','{D2}'::timestamptz+interval '13 hours','k-p2-again')$q$, 'eq:pending')
    ) as x(name, who, sql, expect)
  loop
    sql := t.sql;
    sql := replace(sql, '{T1}', t1); sql := replace(sql, '{T2}', t2); sql := replace(sql, '{T3}', t3);
    sql := replace(sql, '{C1M}', c1m); sql := replace(sql, '{C1}', c1); sql := replace(sql, '{C2}', c2); sql := replace(sql, '{C3}', c3);
    sql := replace(sql, '{B1P2}', b1p2); sql := replace(sql, '{B1}', b1); sql := replace(sql, '{B2}', b2);
    sql := replace(sql, '{A1}', a1::text); sql := replace(sql, '{P1}', p1::text); sql := replace(sql, '{P2}', p2::text);
    sql := replace(sql, '{D2}', d2::text);

    who := case t.who when 'a1' then a1 when 'a2' then a2 when 'p1' then p1 when 'p2' then p2 else null end;
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
