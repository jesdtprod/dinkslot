-- Live status updates: club owners see approval/suspension instantly.
-- Realtime applies the table's RLS, so a user only receives rows of clubs they manage
-- (tenants_select policy), never another club's changes.
alter publication supabase_realtime add table public.tenants;
