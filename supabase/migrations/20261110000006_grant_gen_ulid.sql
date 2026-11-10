-- Column defaults call gen_ulid() as the inserting user, so it needs execute.
-- It is a pure id generator and reveals nothing.
grant execute on function public.gen_ulid() to authenticated;
