-- Fix the durable public-application rate limiter after PostgreSQL resolves the
-- PL/pgSQL variable name `current_time` as the SQL CURRENT_TIME value (timetz).
-- The comparison against expires_at (timestamptz) then fails with SQLSTATE
-- 42883 before any counter can be recorded.

begin;

create or replace function public.consume_public_application_rate_limit(
  p_rate_key text,
  p_scope text,
  p_window_seconds integer,
  p_request_limit integer
)
returns table (is_allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  counter public.public_application_rate_limits%rowtype;
  request_now timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_rate_key), '') is null
    or nullif(btrim(p_scope), '') is null
    or p_rate_key !~ '^[0-9a-f]{64}$'
    or char_length(p_scope) > 64
    or p_window_seconds is null
    or p_request_limit is null
    or p_window_seconds < 1
    or p_request_limit < 1 then
    raise exception 'Invalid public application rate-limit input';
  end if;

  delete from public.public_application_rate_limits
  where expires_at <= request_now;

  insert into public.public_application_rate_limits (
    rate_key,
    scope,
    window_started_at,
    expires_at,
    request_count,
    updated_at
  )
  values (
    p_rate_key,
    p_scope,
    request_now,
    request_now + make_interval(secs => p_window_seconds),
    1,
    request_now
  )
  on conflict (rate_key, scope) do update
  set
    window_started_at = case
      when public.public_application_rate_limits.expires_at <= request_now
        then request_now
      else public.public_application_rate_limits.window_started_at
    end,
    expires_at = case
      when public.public_application_rate_limits.expires_at <= request_now
        then request_now + make_interval(secs => p_window_seconds)
      else public.public_application_rate_limits.expires_at
    end,
    request_count = case
      when public.public_application_rate_limits.expires_at <= request_now
        then 1
      else public.public_application_rate_limits.request_count + 1
    end,
    updated_at = request_now
  returning * into counter;

  return query
  select
    counter.request_count <= p_request_limit,
    case
      when counter.request_count <= p_request_limit then 0
      else greatest(
        1,
        ceil(extract(epoch from (counter.expires_at - request_now)))::integer
      )
    end;
end;
$$;

revoke all on function public.consume_public_application_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_application_rate_limit(text, text, integer, integer)
  to service_role;

commit;
