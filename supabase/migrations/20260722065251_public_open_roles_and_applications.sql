-- Public Open Roles fields remain private unless a consultant explicitly
-- enables a complete listing. This migration is intentionally additive.
set statement_timeout = '60s';
set lock_timeout = '5s';

-- Supabase applies migration statements individually, so keep this multi-step
-- schema, privilege, Storage, and publication change atomic.
begin;

-- Fail before DDL when a prerequisite migration or live-schema invariant is
-- missing. These checks deliberately do not repair or delete production data.
do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'public.jobs',
    'public.clients',
    'public.candidates',
    'public.candidate_associations',
    'public.page_view_permissions',
    'public.column_permissions',
    'storage.buckets',
    'auth.users'
  ]
  loop
    if to_regclass(required_table) is null then
      raise exception 'Public Open Roles migration prerequisite is missing: %', required_table;
    end if;
  end loop;

  if exists (
    select 1
    from public.jobs
    where mandate_status is null
       or status is null
       or mandate_status not in (
         'Ongoing (P1)',
         'Delivered (P2)',
         'Paused (P3)',
         'Completed',
         'Scrapped'
       )
       or status is distinct from mandate_status
  ) then
    raise exception 'Apply and verify 20260720093624_mandate_priority_statuses.sql before Public Open Roles';
  end if;

  if to_regclass('public.candidates_normalized_email_unique') is null
    or to_regclass('public.candidates_normalized_mobile_unique') is null then
    raise exception 'Candidate normalized email/mobile unique indexes must exist before Public Open Roles conversion';
  end if;

  if exists (
    select 1
    from public.candidate_associations
    where job_id is not null
    group by candidate_id, job_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate candidate/mandate associations must be reviewed before Public Open Roles conversion';
  end if;

  if to_regclass('public.public_applications') is not null
    or to_regclass('public.public_application_rate_limits') is not null then
    raise exception 'A partial Public Open Roles staging schema already exists; inspect it before applying this migration';
  end if;

  if exists (
    select 1
    from information_schema.columns column_info
    join (
      values
        ('is_public', 'bool'),
        ('public_slug', 'text'),
        ('public_name', 'text'),
        ('public_location', 'text'),
        ('public_experience', 'text'),
        ('public_skills', '_text'),
        ('application_deadline', 'date'),
        ('public_jd', 'text')
    ) expected(column_name, udt_name)
      on expected.column_name = column_info.column_name
    where column_info.table_schema = 'public'
      and column_info.table_name = 'jobs'
      and column_info.udt_name <> expected.udt_name
  ) then
    raise exception 'One or more existing Public Open Roles job columns has an incompatible type';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'candidate_associations'
      and column_name = 'public_application_id'
      and udt_name <> 'uuid'
  ) then
    raise exception 'candidate_associations.public_application_id exists with an incompatible type';
  end if;

  if exists (
    select 1
    from storage.buckets
    where id = 'public-applications'
       or name = 'public-applications'
  ) then
    raise exception 'A public-applications Storage bucket already exists; inspect and preserve it before applying this migration';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%public-applications%'
        or coalesce(with_check, '') ilike '%public-applications%'
      )
  ) then
    raise exception 'Review and remove existing public-applications Storage policies before applying this migration';
  end if;

  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL 15 or newer is required to hide public_application_id from Realtime';
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication must exist before Public Open Roles';
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and puballtables
  ) then
    raise exception 'Inspect the all-tables supabase_realtime publication before Public Open Roles';
  end if;

  if exists (
    select 1
    from pg_publication_namespace publication_namespace
    join pg_publication publication
      on publication.oid = publication_namespace.pnpubid
    join pg_namespace namespace
      on namespace.oid = publication_namespace.pnnspid
    where publication.pubname = 'supabase_realtime'
      and namespace.nspname = 'public'
  ) then
    raise exception 'Inspect the public-schema supabase_realtime membership before Public Open Roles';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidate_associations'
      and nullif(btrim(rowfilter), '') is not null
  ) then
    raise exception 'Preserve the existing candidate_associations Realtime row filter before Public Open Roles';
  end if;

  if exists (
    select 1
    from pg_class
    where oid = 'public.candidate_associations'::regclass
      and relreplident <> 'd'
  ) then
    raise exception 'Inspect the non-default candidate_associations replica identity before Public Open Roles';
  end if;
end $$;

alter table public.jobs
  add column if not exists is_public boolean not null default false,
  add column if not exists public_slug text,
  add column if not exists public_name text,
  add column if not exists public_location text,
  add column if not exists public_experience text,
  add column if not exists public_skills text[] not null default '{}'::text[],
  add column if not exists application_deadline date,
  add column if not exists public_jd text;

-- A correctly typed partial/manual deployment may have omitted defaults or
-- nullability. Normalize those attributes without altering public values.
alter table public.jobs
  alter column is_public set default false,
  alter column public_skills set default '{}'::text[];

-- Never infer publication from existing internal mandate data.
update public.jobs
set is_public = false;

update public.jobs
set public_skills = '{}'::text[]
where public_skills is null;

alter table public.jobs
  alter column is_public set not null,
  alter column public_skills set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_public_slug_format'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_public_slug_format
      check (
        public_slug is null
        or (
          public_slug = btrim(public_slug)
          and public_slug = lower(public_slug)
          and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        )
      ) not valid;
  end if;
end $$;

alter table public.jobs validate constraint jobs_public_slug_format;

create unique index if not exists jobs_public_slug_unique_idx
  on public.jobs (public_slug)
  where public_slug is not null;

create or replace function public.keep_job_public_slug_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.public_slug is not null
    and new.public_slug is distinct from old.public_slug then
    raise exception 'A generated public mandate slug is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_job_public_slug_immutable()
  from public, anon, authenticated;

drop trigger if exists jobs_public_slug_immutable on public.jobs;
create trigger jobs_public_slug_immutable
before update of public_slug on public.jobs
for each row execute function public.keep_job_public_slug_immutable();

create index if not exists jobs_public_eligibility_idx
  on public.jobs (application_deadline, public_slug)
  where is_public = true
    and mandate_status = 'Ongoing (P1)';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_public_listing_complete'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_public_listing_complete
      check (
        not is_public
        or (
          nullif(btrim(public_slug), '') is not null
          and nullif(btrim(public_name), '') is not null
          and nullif(btrim(public_location), '') is not null
          and nullif(btrim(public_experience), '') is not null
          and cardinality(public_skills) > 0
          and array_position(public_skills, null) is null
          and nullif(btrim(array_to_string(public_skills, '')), '') is not null
          and application_deadline is not null
          and nullif(btrim(public_jd), '') is not null
        )
      ) not valid;
  end if;
end $$;

alter table public.jobs validate constraint jobs_public_listing_complete;

create table public.public_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,

  public_role_name text not null,
  internal_job_title_snapshot text not null,
  client_name_snapshot text not null,
  mandate_consultants_snapshot text[] not null default '{}'::text[],

  full_name text not null,
  email text not null,
  email_normalized text not null,
  mobile_number text not null,
  mobile_normalized text not null,
  current_designation text not null,
  current_organisation text not null,
  experience_years numeric not null,
  location text not null,
  skills text[] not null,
  notice_period integer not null,
  current_salary integer not null,
  expected_salary integer not null,
  linkedin_url text not null,
  comments text not null,
  open_to_relocate text not null,

  cv_storage_path text not null,
  cv_original_name text not null,
  cv_mimetype text not null,
  cv_file_hash text not null,

  application_status text not null default 'pending',
  processing_token uuid,
  processing_started_at timestamptz,

  converted_candidate_id uuid references public.candidates(id) on delete set null,
  converted_association_id uuid references public.candidate_associations(id) on delete set null,
  converted_by uuid references auth.users(id) on delete set null,
  converted_at timestamptz,

  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint public_applications_required_text_check check (
    nullif(btrim(public_role_name), '') is not null
    and nullif(btrim(internal_job_title_snapshot), '') is not null
    and nullif(btrim(client_name_snapshot), '') is not null
    and nullif(btrim(full_name), '') is not null
    and nullif(btrim(email), '') is not null
    and nullif(btrim(email_normalized), '') is not null
    and nullif(btrim(mobile_number), '') is not null
    and nullif(btrim(mobile_normalized), '') is not null
    and nullif(btrim(current_designation), '') is not null
    and nullif(btrim(current_organisation), '') is not null
    and nullif(btrim(location), '') is not null
    and nullif(btrim(linkedin_url), '') is not null
    and nullif(btrim(comments), '') is not null
  ),
  constraint public_applications_identity_normalization_check check (
    email_normalized = lower(btrim(email))
    and mobile_normalized = regexp_replace(mobile_number, '\D', '', 'g')
    and mobile_normalized ~ '^[0-9]+$'
  ),
  constraint public_applications_experience_nonnegative_check
    check (experience_years >= 0),
  constraint public_applications_skills_nonempty_check check (
    cardinality(skills) > 0
    and array_position(skills, null) is null
    and nullif(btrim(array_to_string(skills, '')), '') is not null
  ),
  constraint public_applications_notice_period_nonnegative_check
    check (notice_period >= 0),
  constraint public_applications_current_salary_check
    check (current_salary > 0 and current_salary <= 999999999),
  constraint public_applications_expected_salary_check
    check (expected_salary > 0 and expected_salary <= 999999999),
  constraint public_applications_open_to_relocate_check
    check (open_to_relocate in ('true', 'false', 'NA')),
  constraint public_applications_cv_metadata_check check (
    cv_mimetype = 'application/pdf'
    and nullif(btrim(cv_original_name), '') is not null
    and lower(cv_original_name) like '%.pdf'
    and cv_file_hash ~ '^[0-9a-f]{64}$'
    and (
      cv_storage_path = id::text || '/resume.pdf'
      or cv_storage_path ~ (
        '^' || id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
      )
    )
  ),
  constraint public_applications_status_check check (
    application_status in ('pending', 'converting', 'converted', 'linked_existing', 'rejected')
  ),
  constraint public_applications_processing_state_check check (
    application_status <> 'converting'
    or (processing_token is not null and processing_started_at is not null)
  )
);

-- Lock down the exposed-schema table before creating supporting objects. This
-- remains safe even on deployment runners that do not wrap the file atomically.
alter table public.public_applications enable row level security;
revoke all on table public.public_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.public_applications to service_role;

create or replace function public.touch_public_open_roles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.touch_public_open_roles_updated_at()
  from public, anon, authenticated;

drop trigger if exists public_applications_touch_updated_at
  on public.public_applications;
create trigger public_applications_touch_updated_at
before update on public.public_applications
for each row execute function public.touch_public_open_roles_updated_at();

create unique index if not exists public_applications_active_job_email_unique_idx
  on public.public_applications (job_id, email_normalized)
  where job_id is not null
    and nullif(btrim(email_normalized), '') is not null
    and application_status in ('pending', 'converting');

create unique index if not exists public_applications_active_job_mobile_unique_idx
  on public.public_applications (job_id, mobile_normalized)
  where job_id is not null
    and nullif(btrim(mobile_normalized), '') is not null
    and application_status in ('pending', 'converting');

create index if not exists public_applications_status_created_idx
  on public.public_applications (application_status, created_at desc);
create index if not exists public_applications_created_idx
  on public.public_applications (created_at desc);
create index if not exists public_applications_job_id_idx
  on public.public_applications (job_id);
create index if not exists public_applications_client_id_idx
  on public.public_applications (client_id);
create index if not exists public_applications_email_normalized_idx
  on public.public_applications (email_normalized);
create index if not exists public_applications_mobile_normalized_idx
  on public.public_applications (mobile_normalized);
create index if not exists public_applications_public_role_name_idx
  on public.public_applications (lower(public_role_name));
create index if not exists public_applications_location_idx
  on public.public_applications (lower(location));
create index if not exists public_applications_consultants_gin_idx
  on public.public_applications using gin (mandate_consultants_snapshot);
create index if not exists public_applications_processing_started_idx
  on public.public_applications (processing_started_at)
  where application_status = 'converting';

-- Durable rate-limit counters store only a one-way hash of the request key.
create table public.public_application_rate_limits (
  rate_key text not null,
  scope text not null,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (rate_key, scope),
  constraint public_application_rate_limits_key_hash_check
    check (rate_key ~ '^[0-9a-f]{64}$'),
  constraint public_application_rate_limits_scope_check
    check (nullif(btrim(scope), '') is not null and char_length(scope) <= 64),
  constraint public_application_rate_limits_expiry_check
    check (expires_at > window_started_at),
  constraint public_application_rate_limits_request_count_check
    check (request_count >= 0)
);

alter table public.public_application_rate_limits enable row level security;
revoke all on table public.public_application_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.public_application_rate_limits to service_role;

drop trigger if exists public_application_rate_limits_touch_updated_at
  on public.public_application_rate_limits;
create trigger public_application_rate_limits_touch_updated_at
before update on public.public_application_rate_limits
for each row execute function public.touch_public_open_roles_updated_at();

create index public_application_rate_limits_expiry_idx
  on public.public_application_rate_limits (expires_at);

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
  current_time timestamptz := clock_timestamp();
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

  -- Use each counter's persisted window expiry so cleanup remains safe when
  -- parse and submit scopes use different or later-retuned window lengths.
  delete from public.public_application_rate_limits
  where expires_at <= current_time;

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
    current_time,
    current_time + make_interval(secs => p_window_seconds),
    1,
    current_time
  )
  on conflict (rate_key, scope) do update
  set
    window_started_at = case
      when public.public_application_rate_limits.expires_at <= current_time
        then current_time
      else public.public_application_rate_limits.window_started_at
    end,
    expires_at = case
      when public.public_application_rate_limits.expires_at <= current_time
        then current_time + make_interval(secs => p_window_seconds)
      else public.public_application_rate_limits.expires_at
    end,
    request_count = case
      when public.public_application_rate_limits.expires_at <= current_time
        then 1
      else public.public_application_rate_limits.request_count + 1
    end,
    updated_at = current_time
  returning * into counter;

  return query
  select
    counter.request_count <= p_request_limit,
    case
      when counter.request_count <= p_request_limit then 0
      else greatest(
        1,
        ceil(extract(epoch from (
          counter.window_started_at
          + (counter.expires_at - counter.window_started_at)
          - current_time
        )))::integer
      )
    end;
end;
$$;

revoke all on function public.consume_public_application_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_application_rate_limit(text, text, integer, integer)
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-applications',
  'public-applications',
  false,
  1048576,
  array['application/pdf']::text[]
);

-- No storage.objects policies are created. Only the service-role backend may
-- upload staged CVs or issue short-lived signed URLs.

alter table public.candidate_associations
  add column if not exists public_application_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidate_associations_public_application_id_fkey'
      and conrelid = 'public.candidate_associations'::regclass
  ) then
    alter table public.candidate_associations
      add constraint candidate_associations_public_application_id_fkey
      foreign key (public_application_id)
      references public.public_applications(id)
      on delete set null;
  end if;
end $$;

create unique index if not exists candidate_associations_public_application_unique_idx
  on public.candidate_associations (public_application_id)
  where public_application_id is not null;

-- Existing product logic treats candidate + mandate as one association. The
-- preflight above fails instead of silently skipping this race-safety invariant
-- when historical duplicate rows need manual review.
create unique index if not exists candidate_associations_candidate_job_unique_idx
  on public.candidate_associations (candidate_id, job_id)
  where job_id is not null;

-- Existing authenticated Realtime access publishes candidate association rows.
-- Keep those refresh events, but never expose the staging UUID to a browser.
-- PostgreSQL 15+ publication column lists are required for this guarantee.
do $$
declare
  safe_columns text;
  publication_columns text;
begin
  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
  into safe_columns
  from pg_attribute attribute
  where attribute.attrelid = 'public.candidate_associations'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname <> 'public_application_id';

  if nullif(safe_columns, '') is null then
    raise exception 'Could not determine safe candidate_associations publication columns';
  end if;

  publication_columns := safe_columns;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidate_associations'
  ) then
    select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
    into publication_columns
    from pg_attribute attribute
    where attribute.attrelid = 'public.candidate_associations'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attname <> 'public_application_id'
      and attribute.attname = any (
        select unnest(publication_table.attnames)
        from pg_publication_tables publication_table
        where publication_table.pubname = 'supabase_realtime'
          and publication_table.schemaname = 'public'
          and publication_table.tablename = 'candidate_associations'
      );
  end if;

  if nullif(publication_columns, '') is null then
    raise exception 'Could not preserve candidate_associations Realtime publication columns';
  end if;

  revoke select on table public.candidate_associations
    from public, anon, authenticated;
  execute format(
    'grant select (%s) on public.candidate_associations to authenticated',
    safe_columns
  );
  grant select, insert, update, delete on table public.candidate_associations
    to service_role;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidate_associations'
  ) then
    alter publication supabase_realtime
      drop table public.candidate_associations;
  end if;

  execute format(
    'alter publication supabase_realtime add table public.candidate_associations (%s)',
    publication_columns
  );
end $$;

insert into public.page_view_permissions (page_key, view_permission)
values ('applied_candidates', 'everyone')
on conflict (page_key) do nothing;

insert into public.column_permissions (table_name, column_key, access_mode)
values ('jobs', 'public_careers_listing', 'everyone')
on conflict (table_name, column_key) do nothing;

comment on column public.candidate_associations.public_application_id is
  'Association-level provenance for candidates newly created from Public Open Roles. Existing-candidate links intentionally remain null.';
comment on table public.public_applications is
  'Protected staging records for Public Open Roles applications. Access is backend service-role only.';

-- Realtime is intentionally not enabled for public_applications. The protected
-- page refetches through Express after mutations, avoiding a direct browser
-- SELECT policy on applicant staging data.

commit;

-- ROLLBACK RUNBOOK (manual; do not run as part of deployment):
-- 1. Set every jobs.is_public value to false.
-- 2. Disable /api/public routes and stop new submissions.
-- 3. Export and preserve public.public_applications and the private
--    public-applications bucket objects.
-- 4. Remove candidate_associations.public_application_id only after preserving
--    conversion provenance.
-- 5. Dropping public.public_applications or deleting the private bucket is
--    destructive and permanently deletes applicant records/CVs.
