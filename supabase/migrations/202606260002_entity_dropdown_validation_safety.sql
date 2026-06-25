create or replace view public.data_issue_candidate_associations_missing_job as
select *
from public.candidate_associations
where job_id is null
  and nullif(btrim(coalesce(job_title, '')), '') is not null;

create or replace view public.data_issue_candidate_associations_wrong_client as
select ca.*
from public.candidate_associations ca
join public.jobs j on j.id = ca.job_id
where ca.client_id is not null
  and j.client_id is not null
  and ca.client_id <> j.client_id;

create or replace view public.data_issue_duplicate_jobs as
select client_id, lower(btrim(title)) as normalized_title, count(*) as duplicate_count, array_agg(id) as job_ids
from public.jobs
where client_id is not null
  and nullif(btrim(coalesce(title, '')), '') is not null
group by client_id, lower(btrim(title))
having count(*) > 1;

create or replace view public.data_issue_duplicate_candidate_emails as
select lower(btrim(email)) as normalized_email, count(*) as duplicate_count, array_agg(id) as candidate_ids
from public.candidates
where lower(btrim(coalesce(email, ''))) not in ('', '-', 'n/a', 'na', 'none')
group by lower(btrim(email))
having count(*) > 1;

create or replace view public.data_issue_duplicate_candidate_mobiles as
select regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g') as normalized_mobile, count(*) as duplicate_count, array_agg(id) as candidate_ids
from public.candidates
where regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g') <> ''
  and btrim(coalesce(mobile_number, '')) <> '-'
group by regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g')
having count(*) > 1;

create or replace view public.data_issue_duplicate_root_clients as
select lower(btrim(coalesce(client_name, name))) as normalized_name, count(*) as duplicate_count, array_agg(id) as client_ids
from public.clients
where (client_group_id is null or client_group_id = id)
  and nullif(btrim(coalesce(client_name, name, '')), '') is not null
group by lower(btrim(coalesce(client_name, name)))
having count(*) > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'candidate_associations_client_id_required'
      and conrelid = 'public.candidate_associations'::regclass
  ) then
    alter table public.candidate_associations
      add constraint candidate_associations_client_id_required check (client_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'candidate_associations_job_id_required'
      and conrelid = 'public.candidate_associations'::regclass
  ) then
    alter table public.candidate_associations
      add constraint candidate_associations_job_id_required check (job_id is not null) not valid;
  end if;
end $$;

create or replace function public.validate_candidate_association_job_client()
returns trigger
language plpgsql
as $$
declare
  selected_job public.jobs%rowtype;
begin
  if new.client_id is null then
    raise exception 'candidate_associations.client_id is required';
  end if;
  if new.job_id is null then
    raise exception 'candidate_associations.job_id is required';
  end if;

  select * into selected_job from public.jobs where id = new.job_id;
  if selected_job.id is null then
    raise exception 'candidate_associations.job_id must reference an existing job';
  end if;
  if selected_job.client_id <> new.client_id then
    raise exception 'candidate_associations.job_id must belong to selected client_id';
  end if;

  new.job_title := coalesce(selected_job.title, new.job_title);
  return new;
end;
$$;

drop trigger if exists trg_validate_candidate_association_job_client on public.candidate_associations;
create trigger trg_validate_candidate_association_job_client
before insert or update of client_id, job_id, job_title on public.candidate_associations
for each row execute function public.validate_candidate_association_job_client();

do $$
begin
  if not exists (select 1 from public.data_issue_duplicate_jobs) then
    execute 'create unique index if not exists jobs_client_normalized_title_unique on public.jobs (client_id, lower(btrim(title))) where client_id is not null and nullif(btrim(coalesce(title, '''')), '''') is not null';
  end if;

  if not exists (select 1 from public.data_issue_duplicate_candidate_emails) then
    execute 'create unique index if not exists candidates_normalized_email_unique on public.candidates (lower(btrim(email))) where lower(btrim(coalesce(email, ''''))) not in ('''', ''-'', ''n/a'', ''na'', ''none'')';
  end if;

  if not exists (select 1 from public.data_issue_duplicate_candidate_mobiles) then
    execute 'create unique index if not exists candidates_normalized_mobile_unique on public.candidates (regexp_replace(coalesce(mobile_number, ''''), ''\D'', '''', ''g'')) where regexp_replace(coalesce(mobile_number, ''''), ''\D'', '''', ''g'') <> '''' and btrim(coalesce(mobile_number, '''')) <> ''-''';
  end if;
end $$;
