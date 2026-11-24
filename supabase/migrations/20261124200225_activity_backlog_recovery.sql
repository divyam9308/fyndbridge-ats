-- New clients acknowledge durable activity only after this recorder succeeds.
-- The existing recorder stays unchanged for older clients.
create function public.record_user_activity_backlog(p_user_id uuid, p_intervals jsonb)
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
  if jsonb_typeof(p_intervals) is distinct from 'array' or jsonb_array_length(p_intervals) > 500 then
    raise exception 'Invalid activity intervals';
  end if;
  for v_interval in select value from jsonb_array_elements(p_intervals) loop
    if jsonb_typeof(v_interval) is distinct from 'object'
      or v_interval->>'start' is null or v_interval->>'end' is null then
      raise exception 'Invalid activity interval';
    end if;
    -- Only individually sampled intervals may be recovered; never accept a
    -- single outage-sized span as activity. Authentication supplies the user ID.
    if not isfinite((v_interval->>'start')::timestamptz) or not isfinite((v_interval->>'end')::timestamptz)
      or (v_interval->>'end')::timestamptz - (v_interval->>'start')::timestamptz > interval '120 seconds'
      or (v_interval->>'end')::timestamptz < (v_interval->>'start')::timestamptz then
      raise exception 'Invalid activity interval';
    end if;
    -- Bounded delayed delivery; future and expired time never receive credit.
    v_start := greatest((v_interval->>'start')::timestamptz, v_now - interval '24 hours');
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
revoke all on function public.record_user_activity_backlog(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_user_activity_backlog(uuid, jsonb) to service_role;
