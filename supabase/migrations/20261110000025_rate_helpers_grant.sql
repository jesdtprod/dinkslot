-- public_courts (owner-run view) calls the rate helpers; the role evaluating it needs execute.
-- They only return hourly rates, which are already public on the club and booking pages.
grant execute on function public._rate_at(text, text, numeric, timestamp),
  public._court_rate_range(text, text, numeric, time, time, int) to anon, authenticated;
