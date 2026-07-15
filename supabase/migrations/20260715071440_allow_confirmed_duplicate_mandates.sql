alter table public.jobs
  add column if not exists duplicate_confirmed boolean not null default false;

drop index if exists public.jobs_client_normalized_title_unique;

with ranked_mandates as (
  select
    id,
    row_number() over (
      partition by
        client_id,
        lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g'))
      order by created_at asc nulls last, id asc
    ) as duplicate_rank
  from public.jobs
  where client_id is not null
    and nullif(btrim(coalesce(title, '')), '') is not null
)
update public.jobs as job
set duplicate_confirmed = true
from ranked_mandates
where job.id = ranked_mandates.id
  and ranked_mandates.duplicate_rank > 1
  and job.duplicate_confirmed is not true;

create unique index if not exists jobs_client_normalized_title_primary_unique
  on public.jobs (
    client_id,
    lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g'))
  )
  where client_id is not null
    and nullif(btrim(coalesce(title, '')), '') is not null
    and duplicate_confirmed = false;

create or replace view public.data_issue_duplicate_jobs as
select
  client_id,
  lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g')) as normalized_title,
  count(*) as duplicate_count,
  array_agg(id) as job_ids
from public.jobs
where client_id is not null
  and nullif(btrim(coalesce(title, '')), '') is not null
  and duplicate_confirmed = false
group by
  client_id,
  lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g'))
having count(*) > 1;
