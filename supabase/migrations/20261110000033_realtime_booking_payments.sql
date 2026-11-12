-- Payment proof changes refresh staff approval cards through existing staff-scoped RLS.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'booking_payments') then
    alter publication supabase_realtime add table public.booking_payments;
  end if;
end $$;
