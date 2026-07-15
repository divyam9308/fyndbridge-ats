-- Read-only, backend-only projections for schema-constrained AI filters.
-- The views flatten derived and related values so PostgREST can apply one
-- recursive filter before count/order/range pagination. They deliberately
-- expose no write path and run with the caller's privileges.

create or replace view public.client_ai_filter_rows
with (security_invoker = true)
as
select
  client.*,
  nullif(substring(client.client_display_id from '([0-9]+)$'), '')::integer as ai_client_display_number,
  lower(btrim(coalesce(client.consultant_name, ''))) as ai_consultant_name_normalized,
  contact_values.contact_person_search as ai_contact_person_search,
  contact_values.mobile_search as ai_mobile_search,
  contact_values.email_search as ai_email_search,
  contact_values.linkedin_search as ai_linkedin_search,
  contact_values.designation_search as ai_designation_search,
  contact_values.comments_search as ai_comments_search,
  follow_up.latest_follow_up_date as ai_follow_up_date,
  follow_up.first_follow_up_date as ai_first_follow_up_date,
  follow_up.next_follow_up_date as ai_next_follow_up_date,
  follow_up.follow_up_ranges as ai_follow_up_ranges,
  coalesce(follow_up.follow_up_count, 0)::integer as ai_follow_up_count,
  (
    follow_up.follow_up_count > 0
    and follow_up.next_follow_up_date is null
    and follow_up.latest_follow_up_date < current_date
  ) as ai_follow_up_overdue,
  (
    follow_up.next_follow_up_date is not null
  ) as ai_follow_up_upcoming,
  (
    nullif(btrim(coalesce(client.terms_signed_type, '')), '') is not null
    and btrim(coalesce(client.terms_signed_type, '')) <> '-'
  ) as ai_terms_signed,
  case
    when client.terms_signed_type in ('%', 'Slab %') then null
    when value_number.amount is null then null
    when lower(coalesce(client.terms_value, '')) ~ '(crore|crores|cr)([^a-z]|$)' then value_number.amount * 10000000
    when lower(coalesce(client.terms_value, '')) ~ '(lakh|lakhs|lac|lpa)([^a-z]|$)' then value_number.amount * 100000
    when value_number.amount <= 200 then value_number.amount * 100000
    else value_number.amount
  end as ai_terms_value_amount
from public.clients as client
left join lateral (
  select
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'contact_person', to_jsonb(item) ->> 'contact', '')), ''), ' ') as contact_person_search,
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'mobile', to_jsonb(item) ->> 'phone', '')), ''), ' ') as mobile_search,
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'email', to_jsonb(item) ->> 'email_id', '')), ''), ' ') as email_search,
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'linkedin', '')), ''), ' ') as linkedin_search,
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'designation', '')), ''), ' ') as designation_search,
    string_agg(distinct nullif(btrim(coalesce(to_jsonb(item) ->> 'comments', to_jsonb(item) ->> 'notes', '')), ''), ' ') as comments_search
  from public.clients as item
  where item.client_group_id = client.id
) as contact_values on true
left join lateral (
  select
    max(item.follow_up_date) as latest_follow_up_date,
    min(item.follow_up_date) as first_follow_up_date,
    min(item.follow_up_date) filter (where item.follow_up_date >= current_date) as next_follow_up_date,
    range_agg(daterange(item.follow_up_date, item.follow_up_date, '[]')) as follow_up_ranges,
    count(*) as follow_up_count
  from public.client_follow_ups as item
  where item.client_id in (
    select grouped_client.id
    from public.clients as grouped_client
    where grouped_client.client_group_id = client.id
  )
) as follow_up on true
left join lateral (
  select substring(replace(coalesce(client.terms_value, ''), ',', '') from '([0-9]+([.][0-9]+)?)')::numeric as amount
) as value_number on true
where client.id = client.client_group_id;

create or replace view public.mandate_ai_filter_rows
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

create index if not exists jobs_consultants_gin_idx
  on public.jobs using gin (consultants);

create index if not exists jobs_allocation_date_ai_filter_idx
  on public.jobs (allocation_date);

create index if not exists jobs_budget_ai_filter_idx
  on public.jobs (budget);

create index if not exists jobs_experience_min_ai_filter_idx
  on public.jobs (experience_min);

revoke all on public.client_ai_filter_rows from public, anon, authenticated;
revoke all on public.mandate_ai_filter_rows from public, anon, authenticated;
grant select on public.client_ai_filter_rows to service_role;
grant select on public.mandate_ai_filter_rows to service_role;
