-- Recent browser intervals are unioned, rather than added, to make retries and
-- simultaneous tabs/devices idempotent. Only the authenticated server writes.
create function public.activity_range_seconds(p_ranges tstzmultirange)
returns double precision language sql immutable strict security invoker
set search_path = '' as $$
  select coalesce(sum(extract(epoch from upper(r) - lower(r))), 0)::double precision
  from unnest(p_ranges) r;
$$;
revoke all on function public.activity_range_seconds(tstzmultirange) from public, anon, authenticated;
grant execute on function public.activity_range_seconds(tstzmultirange) to service_role;

create table public.user_daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  active_periods tstzmultirange not null default '{}'::tstzmultirange,
  active_seconds double precision generated always as (public.activity_range_seconds(active_periods)) stored,
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);
alter table public.user_daily_activity enable row level security;
revoke all on public.user_daily_activity from public, anon, authenticated;
grant select, insert, update on public.user_daily_activity to service_role;

create function public.record_user_activity(p_user_id uuid, p_intervals jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_interval jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_ranges tstzmultirange := '{}'::tstzmultirange;
begin
  if jsonb_typeof(p_intervals) <> 'array' or jsonb_array_length(p_intervals) > 500 then
    raise exception 'Invalid activity intervals';
  end if;
  for v_interval in select value from jsonb_array_elements(p_intervals) loop
    -- Never credit offline gaps or trust a client-supplied total/date/user ID.
    v_start := greatest((v_interval->>'start')::timestamptz, v_now - interval '120 seconds');
    v_end := least((v_interval->>'end')::timestamptz, v_now);
    if v_start < v_end then
      v_ranges := v_ranges + tstzmultirange(tstzrange(v_start, v_end, '[)'));
    end if;
  end loop;
  if isempty(v_ranges) then return; end if;
  -- Consistent day order also prevents deadlocks around IST midnight.
  for v_day in select d::date from generate_series(
    (lower(v_ranges) at time zone 'Asia/Kolkata')::date::timestamp,
    (upper(v_ranges) at time zone 'Asia/Kolkata')::date::timestamp,
    interval '1 day') d loop
    v_day_start := v_day::timestamp at time zone 'Asia/Kolkata';
    v_day_end := (v_day + 1)::timestamp at time zone 'Asia/Kolkata';
    insert into public.user_daily_activity(user_id, activity_date, active_periods)
    values(p_user_id, v_day, v_ranges * tstzmultirange(tstzrange(v_day_start, v_day_end, '[)')))
    on conflict (user_id, activity_date) do update set
      active_periods = public.user_daily_activity.active_periods + excluded.active_periods,
      updated_at = v_now;
  end loop;
end;
$$;
revoke all on function public.record_user_activity(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_user_activity(uuid, jsonb) to service_role;

create function public.user_activity_summary(p_user_ids uuid[], p_start date, p_end date)
returns table(user_id uuid, activity_date date, today_seconds double precision,
  average_seconds double precision, average_days integer)
language sql stable security invoker set search_path = '' as $$
  with bounds as (
    select (now() at time zone 'Asia/Kolkata')::date as today,
      least(p_end, (now() at time zone 'Asia/Kolkata')::date) as end_date
  ), working_days as (
    select d::date as activity_date from bounds b,
      generate_series(p_start::timestamp, b.end_date::timestamp, interval '1 day') d
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
    and (a.activity_date = b.today or a.activity_date between p_start and b.end_date)
  group by u.id, b.today, days.n;
$$;
revoke all on function public.user_activity_summary(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.user_activity_summary(uuid[], date, date) to service_role;
