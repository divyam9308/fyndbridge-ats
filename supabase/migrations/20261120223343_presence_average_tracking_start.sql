-- Activity tracking launched on 21 November 2026 (IST). Exclude earlier
-- dates from both sides of the average; later quarters retain their own start.
create or replace function public.user_activity_summary(p_user_ids uuid[], p_start date, p_end date)
returns table(user_id uuid, activity_date date, today_seconds double precision,
  average_seconds double precision, average_days integer)
language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
      greatest(p_start, date '2026-11-21') as start_date,
      least(p_end, (now() at time zone 'Asia/Kolkata')::date) as end_date
  ), working_days as (
    select d::date as activity_date from bounds b,
      generate_series(b.start_date::timestamp, b.end_date::timestamp, interval '1 day') d
    where extract(isodow from d) between 1 and 6
      and not exists (
        select 1 from public.company_holidays h
        where h.holiday_date = d::date and h.is_active
      )
  ), days as (
    select count(*)::integer as n from working_days
  )
  select u.id, b.today,
    coalesce(sum(a.active_seconds) filter (where a.activity_date = b.today), 0)::double precision,
    case when days.n = 0 then 0 else
      coalesce(sum(a.active_seconds) filter (where exists (
        select 1 from working_days w where w.activity_date = a.activity_date
      )), 0) / days.n end::double precision,
    days.n
  from unnest(p_user_ids) u(id) cross join bounds b cross join days
  left join public.user_daily_activity a on a.user_id = u.id
    and (a.activity_date = b.today or a.activity_date between b.start_date and b.end_date)
  group by u.id, b.today, days.n;
$$;
revoke all on function public.user_activity_summary(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.user_activity_summary(uuid[], date, date) to service_role;
