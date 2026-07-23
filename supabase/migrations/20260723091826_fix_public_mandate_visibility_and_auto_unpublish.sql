set statement_timeout = '60s';
set lock_timeout = '5s';

begin;

do $$
begin
  if to_regclass('public.jobs') is null
    or to_regclass('public.clients') is null
    or to_regclass('public.mandate_ai_filter_rows') is null then
    raise exception 'Mandate visibility repair prerequisites are missing';
  end if;
end $$;

-- PostgreSQL expands job.* when a view is created. The public listing columns
-- were added after this view, so recreate it to include the current jobs shape.
drop view public.mandate_ai_filter_rows;

create view public.mandate_ai_filter_rows
with (security_invoker = true)
as
select
  job.*,
  nullif(substring(job.job_display_id from '([0-9]+)$'), '')::integer as ai_job_display_number,
  linked_client.client_display_id as ai_client_display_id,
  linked_client.client_name as ai_client_name,
  linked_client.name as ai_client_legacy_name,
  array(
    select lower(btrim(assigned_name))
    from unnest(coalesce(job.consultants, '{}'::text[])) as assigned_name
    where btrim(assigned_name) not in ('', '-')
  ) as ai_consultants_normalized,
  cardinality(array(
    select assigned_name
    from unnest(coalesce(job.consultants, '{}'::text[])) as assigned_name
    where btrim(assigned_name) not in ('', '-')
  )) as ai_consultant_count,
  lower(btrim(coalesce(job.team_lead, ''))) as ai_team_lead_normalized,
  budget_bounds.minimum as ai_budget_min_lpa,
  budget_bounds.maximum as ai_budget_max_lpa,
  case
    when budget_bounds.minimum is null then null
    when budget_bounds.maximum is null then 1000000000::numeric
    else budget_bounds.maximum
  end as ai_budget_ceiling_lpa,
  experience_bounds.minimum as ai_experience_min_years,
  experience_bounds.maximum as ai_experience_max_years,
  case
    when experience_bounds.minimum is null then null
    when experience_bounds.maximum is null then 1000000000::numeric
    else experience_bounds.maximum
  end as ai_experience_ceiling_years
from public.jobs as job
left join public.clients as linked_client on linked_client.id = job.client_id
left join lateral (
  select
    case
      when lower(btrim(coalesce(job.budget, ''))) ~ '^>[[:space:]]*[0-9]+' then substring(lower(job.budget) from '([0-9]+([.][0-9]+)?)')::numeric
      when lower(btrim(coalesce(job.budget, ''))) ~ '^[0-9]+([.][0-9]+)?[[:space:]]*-' then substring(lower(job.budget) from '^([0-9]+([.][0-9]+)?)')::numeric
      else null
    end as minimum,
    case
      when lower(btrim(coalesce(job.budget, ''))) ~ '^[0-9]+([.][0-9]+)?[[:space:]]*-' then substring(lower(job.budget) from '-[[:space:]]*([0-9]+([.][0-9]+)?)')::numeric
      else null
    end as maximum
) as budget_bounds on true
left join lateral (
  select
    coalesce(
      job.experience_min::numeric,
      case
        when lower(btrim(coalesce(job.experience_label, ''))) ~ '(fresher|entry[ -]?level)' then 0::numeric
        else substring(lower(coalesce(job.experience_label, '')) from '([0-9]+([.][0-9]+)?)')::numeric
      end
    ) as minimum,
    case
      when lower(coalesce(job.experience_label, '')) ~ '[0-9]+([.][0-9]+)?[[:space:]]*-[[:space:]]*[0-9]+' then substring(lower(job.experience_label) from '-[[:space:]]*([0-9]+([.][0-9]+)?)')::numeric
      when lower(coalesce(job.experience_label, '')) ~ '[0-9]+([.][0-9]+)?[[:space:]]*\+' then null
      when lower(btrim(coalesce(job.experience_label, ''))) ~ '(fresher|entry[ -]?level)' then 0::numeric
      else coalesce(job.experience_min::numeric, substring(lower(coalesce(job.experience_label, '')) from '([0-9]+([.][0-9]+)?)')::numeric)
    end as maximum
) as experience_bounds on true;

revoke all on public.mandate_ai_filter_rows from public, anon, authenticated;
grant select on public.mandate_ai_filter_rows to service_role;

do $$
declare
  required_public_columns text[] := array[
    'is_public',
    'public_slug',
    'public_name',
    'public_location',
    'public_experience',
    'public_skills',
    'application_deadline',
    'public_jd'
  ];
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mandate_ai_filter_rows'
      and column_name = any(required_public_columns)
  ) <> cardinality(required_public_columns) then
    raise exception 'mandate_ai_filter_rows is missing public listing columns';
  end if;
end $$;

create or replace function public.jobs_auto_unpublish_non_ongoing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.mandate_status is distinct from 'Ongoing (P1)' then
    new.is_public := false;
  end if;
  return new;
end;
$$;

revoke all on function public.jobs_auto_unpublish_non_ongoing() from public, anon, authenticated;

drop trigger if exists jobs_auto_unpublish_non_ongoing on public.jobs;
create trigger jobs_auto_unpublish_non_ongoing
before insert or update of mandate_status, status, is_public
on public.jobs
for each row
execute function public.jobs_auto_unpublish_non_ongoing();

-- Bring forward any listing that closed before this invariant existed.
update public.jobs
set is_public = false,
    updated_at = clock_timestamp()
where is_public = true
  and mandate_status is distinct from 'Ongoing (P1)';

commit;
