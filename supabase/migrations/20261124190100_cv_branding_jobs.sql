-- Only server workers can access originals or branding jobs. Existing CVs are untouched.
create table public.cv_branding_jobs (
  id uuid primary key default gen_random_uuid(),
  target_path text not null unique,
  source_path text,
  source_extension text not null check (source_extension in ('pdf','doc','docx')),
  original_name text not null,
  source_sha256 text not null,
  status text not null default 'queued' check (status in ('staging','queued','processing','finalizing','ready','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  result_sha256 text,
  file_size bigint,
  page_count integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'ready' or (source_path is null and result_sha256 is not null and page_count > 0))
);
alter table public.cv_branding_jobs enable row level security;
revoke all on public.cv_branding_jobs from public, anon, authenticated;
grant all on public.cv_branding_jobs to service_role;
create index cv_branding_jobs_pending on public.cv_branding_jobs(next_attempt_at, created_at)
  where status <> 'ready';

create function public.claim_cv_branding_jobs(p_paths text[] default null, p_limit integer default 3)
returns jsonb language sql security invoker set search_path = '' as $$
  with pending as (
    select id from public.cv_branding_jobs
    where (p_paths is null or target_path = any(p_paths))
      and (lease_until is null or lease_until < now())
      and next_attempt_at <= now()
      and ((status in ('queued','processing','failed') and attempts < 3)
        or status = 'finalizing' or (status = 'cancelled' and source_path is not null))
    order by created_at for update skip locked limit greatest(1, least(p_limit, 5))
  ), claimed as (
    update public.cv_branding_jobs j
    set status = case when j.status in ('finalizing','cancelled') then j.status else 'processing' end,
      attempts = j.attempts + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '2 minutes', updated_at = now()
    from pending where j.id = pending.id returning j.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) from claimed;
$$;
revoke all on function public.claim_cv_branding_jobs(text[],integer) from public, anon, authenticated;
grant execute on function public.claim_cv_branding_jobs(text[],integer) to service_role;

-- Storage staging bucket: never add user policies for these temporary originals.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cv-branding-staging','cv-branding-staging',false,10485760,array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]) on conflict(id) do nothing;
