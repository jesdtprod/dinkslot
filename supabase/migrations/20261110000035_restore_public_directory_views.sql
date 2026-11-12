-- These filtered directory views intentionally expose approved venues and active courts.
-- Use the view owner's permissions; visitors do not have direct access to base tables.
alter view public.public_clubs set (security_invoker = false, security_barrier = true);
alter view public.public_courts set (security_invoker = false, security_barrier = true);
grant select on public.public_clubs, public.public_courts to anon, authenticated;
